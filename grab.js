const Vec3 = require('vec3');
const db = require('./db');
const config = require('./config');
const mcData = require('minecraft-data')('1.21.11');
const { gotoNear } = require('./pathfinder');
const taskQueue = require('./taskQueue');

class GrabService {
    constructor(bot) {
        this.bot = bot;
        this.isGrabbing = false;
        this.pathTimeoutMs = Math.max(3000, Number(config.grabPathTimeoutMs) || 12000);
    }

    normalizeCount(number) {
        const n = Number(number);
        if (Number.isNaN(n) || n <= 0) return 16;
        return Math.min(2304, Math.floor(n));
    }

    resolveItem(itemInput) {
        const raw = (itemInput || '').trim();
        if (!raw) return null;

        const normalizedId = raw.startsWith('minecraft:') ? raw : `minecraft:${raw}`;

        let item = db.prepare(`
            SELECT id, name_zh, count
            FROM inventory
            WHERE id = ? OR id = ? OR name_zh = ?
            LIMIT 1
        `).get(normalizedId, raw, raw);

        if (!item) {
            item = db.prepare(`
                SELECT id, name_zh, count
                FROM inventory
                WHERE id LIKE ?
                LIMIT 1
            `).get(`minecraft:${raw.toLowerCase()}`);
        }

        return item || null;
    }

    findAllLocations(itemId) {
        return db.prepare(`
            SELECT chest_x, chest_y, chest_z, SUM(count) AS total_count
            FROM item_locations
            WHERE item_id = ?
            GROUP BY chest_x, chest_y, chest_z
            ORDER BY total_count DESC, chest_y DESC
        `).all(itemId);
    }

    getInventoryCount(itemType) {
        return this.bot.inventory.items()
            .filter((x) => x.type === itemType)
            .reduce((s, x) => s + x.count, 0);
    }

    async waitForInventoryDelta(itemType, baseCount, timeoutMs = 900) {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            const now = this.getInventoryCount(itemType);
            if (now > baseCount) {
                return now - baseCount;
            }
            await new Promise((r) => setTimeout(r, 80));
        }
        return Math.max(0, this.getInventoryCount(itemType) - baseCount);
    }

    getPlayerSlotRange(container) {
        const slots = container.slots || [];
        const start = Number.isInteger(container.inventoryStart)
            ? container.inventoryStart
            : Math.max(0, slots.length - 36);
        const endExclusive = Number.isInteger(container.inventoryEnd)
            ? Math.min(slots.length, container.inventoryEnd + 1)
            : slots.length;
        return { start, endExclusive };
    }

    findPlayerTargetSlot(container, itemType) {
        const slots = container.slots || [];
        const { start, endExclusive } = this.getPlayerSlotRange(container);

        // 优先叠到玩家背包中已有同类物品槽，减少占位
        for (let i = start; i < endExclusive; i++) {
            const it = slots[i];
            if (it && it.type === itemType && it.count < 64) {
                return i;
            }
        }

        // 其次找空槽
        for (let i = start; i < endExclusive; i++) {
            if (!slots[i]) return i;
        }

        return -1;
    }

    async takePartialFromSlot(container, slotIndex, itemType, count) {
        const targetSlot = this.findPlayerTargetSlot(container, itemType);
        if (targetSlot < 0) {
            throw new Error('玩家背包无可用槽位，无法精确取出');
        }

        // 1) 从容器槽拿起整组
        await this.bot.clickWindow(slotIndex, 0, 0);
        await new Promise((r) => setTimeout(r, 80));

        // 2) 右键 count 次，每次放 1 个到目标玩家槽
        for (let i = 0; i < count; i++) {
            await this.bot.clickWindow(targetSlot, 1, 0);
            await new Promise((r) => setTimeout(r, 45));
        }

        // 3) 剩余放回原容器槽
        await this.bot.clickWindow(slotIndex, 0, 0);
        await new Promise((r) => setTimeout(r, 80));
    }

    sortLocationsByDistance(locations) {
        const currentPos = this.bot?.entity?.position;
        if (!currentPos) {
            // 玩家坐标不可用时，按数据库统计数量降序作为回退
            return [...locations].sort((a, b) => (b.total_count || 0) - (a.total_count || 0));
        }

        return [...locations].sort((a, b) => {
            const da = currentPos.distanceTo(new Vec3(a.chest_x, a.chest_y, a.chest_z));
            const dbb = currentPos.distanceTo(new Vec3(b.chest_x, b.chest_y, b.chest_z));
            if (da !== dbb) return da - dbb;
            return (b.total_count || 0) - (a.total_count || 0);
        });
    }

    async attemptGrabFromLocation(itemMeta, loc, needCount, attemptIndex, totalAttempts) {
        const label = `${loc.chest_x}, ${loc.chest_y}, ${loc.chest_z}`;
        let container = null;
        let before = 0;

        console.log(`[grab] 尝试箱子 ${attemptIndex}/${totalAttempts} @ (${label})，目标再取 ${needCount}`);

        try {
            console.log(`[grab] 前往箱子 (${label})`);
            try {
                await this.goNear(loc.chest_x, loc.chest_y, loc.chest_z, 5, this.pathTimeoutMs);
                console.log('[grab] 已到达目标附近，准备开箱');
            } catch (err) {
                console.log(`[grab] 寻路失败(${err.message})，继续尝试开箱`);
            }

            const blockPos = new Vec3(loc.chest_x, loc.chest_y, loc.chest_z);
            const block = this.bot.blockAt(blockPos);
            if (!block) {
                console.log(`[grab] 找不到方块 (${label})，切换下一个箱子`);
                return 0;
            }

            console.log(`[grab] 打开容器方块 ${block.name}`);
            container = await this.bot.openBlock(block);
            await new Promise((r) => setTimeout(r, 250));

            before = this.getInventoryCount(itemMeta.id);
            console.log('[grab] 尝试取出物品中...');
            const remaining = await this.withdrawFromContainer(container, itemMeta.id, needCount);
            await new Promise((r) => setTimeout(r, 120));
            const after = this.getInventoryCount(itemMeta.id);
            const gotByInventory = Math.max(0, after - before);
            const gotByRemaining = Math.max(0, needCount - remaining);
            const delayedDelta = await this.waitForInventoryDelta(itemMeta.id, before, 600);
            let got = Math.max(gotByInventory, gotByRemaining, delayedDelta);

            if (container && typeof container.close === 'function') {
                container.close();
                container = null;
                await new Promise((r) => setTimeout(r, 180));
                const afterClose = this.getInventoryCount(itemMeta.id);
                const gotAfterClose = Math.max(0, afterClose - before);
                got = Math.max(got, gotAfterClose);
                console.log(`[grab] 取物判定(inv=${gotByInventory}, rem=${gotByRemaining}, delay=${delayedDelta}, close=${gotAfterClose})`);
            }

            got = Math.min(got, needCount);

            if (got <= 0) {
                console.log('[grab] 该箱子未取出任何物品，切换下一个箱子');
                return 0;
            }

            console.log(`[grab] 该箱子成功取出 ${got}`);
            return got;
        } catch (err) {
            if (taskQueue.isTaskCancelledError(err)) {
                throw err;
            }
            console.log(`[grab] 箱子尝试失败(${err.message})，切换下一个箱子`);
            return 0;
        } finally {
            try {
                if (container && typeof container.close === 'function') {
                    container.close();
                }
            } catch (e) {
                // ignore close errors
            }
        }
    }

    async goNear(x, y, z, range = 5, timeoutMs = this.pathTimeoutMs) {
        return gotoNear(this.bot, x, y, z, range, {
            timeoutMs,
            source: 'grab.goNear',
            title: `前往货箱 ${Math.round(x)}, ${Math.round(y)}, ${Math.round(z)}`
        });
    }

    async withdrawFromContainer(container, itemType, remainTarget) {
        let remaining = remainTarget;
        const startCount = this.getInventoryCount(itemType);

        const slots = container.slots || [];
        // 只遍历容器区槽位，避免误点玩家背包把物品又塞回箱子
        const containerSlotEnd = Number.isInteger(container.inventoryStart)
            ? container.inventoryStart
            : slots.length;

        for (let i = 0; i < containerSlotEnd && remaining > 0; i++) {
            const it = slots[i];
            if (!it || it.type !== itemType) continue;

            // 无论一组还是多组，都按 remaining 精确取，避免“拿超”
            const available = Number.isFinite(it.count) ? Math.max(0, it.count) : remaining;
            const toTake = Math.max(1, Math.min(remaining, available));
            await this.takePartialFromSlot(container, i, itemType, toTake);
            await new Promise((r) => setTimeout(r, 120));

            // 先按计划值扣减，避免背包同步延迟导致重复超拿
            remaining = Math.max(0, remaining - toTake);

            const nowCount = this.getInventoryCount(itemType);
            const moved = Math.max(0, nowCount - startCount);
            const remainingByInventory = Math.max(0, remainTarget - moved);
            // 取更小值，确保不会因为同步延迟把 remaining 反向放大
            remaining = Math.min(remaining, remainingByInventory);
        }

        return remaining;
    }

    async grab(itemInput, number = 16) {
        if (this.isGrabbing) {
            this.bot.chat('正在执行上一次 grab 请求，请稍后再试');
            return;
        }

        const takeCount = this.normalizeCount(number);
        return taskQueue.enqueueTask({
            type: 'movement',
            title: `抓取 ${itemInput} x${takeCount}`,
            meta: {
                source: 'grab.grab',
                target: `${itemInput} x${takeCount}`
            },
            executor: async ({ throwIfAborted }) => {
                this.isGrabbing = true;
                try {
                    console.log(`[grab] 解析物品: ${itemInput}`);
                    const item = this.resolveItem(itemInput);
                    if (!item) {
                        this.bot.chat(`找不到物品: ${itemInput}`);
                        return;
                    }

                    console.log(`[grab] 命中: ${item.id}，库存 ${item.count || 0}`);

                    const allLocations = this.findAllLocations(item.id);
                    if (!allLocations || allLocations.length === 0) {
                        this.bot.chat(`没有 ${item.id} 的位置记录`);
                        return;
                    }

                    console.log(`[grab] 共 ${allLocations.length} 个候选箱子`);
                    const sortedLocations = this.sortLocationsByDistance(allLocations);
                    console.log(`[grab] 最近箱子: (${sortedLocations[0].chest_x}, ${sortedLocations[0].chest_y}, ${sortedLocations[0].chest_z})`);

                    const itemMeta = mcData.itemsByName[item.id.replace('minecraft:', '')];
                    if (!itemMeta) {
                        this.bot.chat(`无法识别物品: ${item.id}`);
                        return;
                    }

                    console.log(`[grab] 寻路超时: ${this.pathTimeoutMs}ms`);

                    let gotTotal = 0;
                    for (let i = 0; i < sortedLocations.length && gotTotal < takeCount; i++) {
                        throwIfAborted();
                        const loc = sortedLocations[i];
                        const remain = takeCount - gotTotal;
                        const got = await this.attemptGrabFromLocation(itemMeta, loc, remain, i + 1, sortedLocations.length);
                        if (got > 0) {
                            gotTotal += got;
                            console.log(`[grab] 累计 ${gotTotal}/${takeCount}`);
                        }
                    }

                    if (gotTotal <= 0) {
                        this.bot.chat(`未取到 ${item.id}，请检查数据库`);
                        return;
                    }
                    this.bot.chat(`grab 完成: ${itemInput} x${gotTotal}${gotTotal < takeCount ? ' (部分)' : ''}`);
                } catch (err) {
                    if (taskQueue.isTaskCancelledError(err)) {
                        throw err;
                    }
                    console.error('[grab错误]', err);
                    this.bot.chat(`grab 失败: ${err.message}`);
                } finally {
                    this.isGrabbing = false;
                }
            }
        });
    }
}

module.exports = GrabService;
