const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { TelegramClient } = require("teleproto");
const { StringSession } = require("teleproto/sessions");

const sessionsPath = path.join(__dirname, "sessions");
const accountsPath = path.join(sessionsPath, "accounts.json");
const schedulesPath = path.join(sessionsPath, "schedules.json");
const activityLogPath = path.join(sessionsPath, "activity-log.json");
const requestError = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const accountIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const scheduleIdPattern = accountIdPattern;
const minimumScheduleIntervalMinutes = 1;
const maximumScheduleIntervalMinutes = 1440;
const maximumActivityLogs = 1000;

class Telegram {
    constructor() {
        this.accounts = new Map();
        this.clients = new Map();
        this.flow = null;
        this.notice = null;
        this.initialized = null;
        this.schedules = new Map();
        this.scheduleTimers = new Map();
        this.scheduleSave = Promise.resolve();
        this.activityLogs = [];
        this.activityLogSave = Promise.resolve();
    }

    async list() {
        await this.#initialize();
        const accounts = [];
        for (const account of this.accounts.values()) {
            const { apiHash, ...publicAccount } = account;
            accounts.push({
                ...publicAccount,
                connected: Boolean(this.clients.get(account.id)?.connected),
                hasSession: await this.#sessionExists(account.id),
                hasSavedCredentials: Boolean(apiHash),
            });
        }
        return { accounts, flow: this.flow ? { ...this.flow.state } : this.notice };
    }

    async listActivityLogs({ limit = 200 } = {}) {
        await this.#initialize();
        const normalizedLimit = Number.isSafeInteger(limit) ? Math.min(Math.max(limit, 1), 500) : 200;
        return { logs: this.activityLogs.slice(0, normalizedLimit) };
    }

    async login({ accountId, apiId, apiHash, phoneNumber = "" } = {}) {
        await this.#initialize();
        if (this.flow) {
            throw requestError("Finish or cancel the current Telegram sign-in first.", 409);
        }

        const existingAccount = accountId ? this.#getAccount(accountId) : null;
        if (accountId && !existingAccount) {
            throw requestError("Saved Telegram account was not found.", 404);
        }
        if (existingAccount && this.clients.get(existingAccount.id)?.connected) {
            throw requestError("This Telegram account is already connected.", 409);
        }

        const numericApiId = Number(apiId ?? existingAccount?.apiId);
        if (!Number.isSafeInteger(numericApiId) || numericApiId <= 0) {
            throw requestError("Enter a valid numeric API ID.");
        }
        const savedApiHash = typeof apiHash === "string" && apiHash.trim()
            ? apiHash.trim()
            : existingAccount?.apiHash;
        if (typeof savedApiHash !== "string" || !/^[a-f0-9]{32}$/i.test(savedApiHash)) {
            throw requestError("Enter a valid 32-character API Hash.");
        }
        if (typeof phoneNumber !== "string" || phoneNumber.length > 32) {
            throw requestError("Enter a valid phone number.");
        }
        if (existingAccount && !await this.#sessionExists(existingAccount.id)) {
            throw requestError("The saved Telegram session was not found.", 404);
        }
        if (!existingAccount && !phoneNumber.trim()) {
            throw requestError("Enter the phone number for the new account.");
        }

        const id = existingAccount?.id || randomUUID();
        const savedSession = existingAccount ? await this.#loadSession(id) : "";
        const client = new TelegramClient(
            new StringSession(savedSession),
            numericApiId,
            savedApiHash,
            { connectionRetries: 5 },
        );
        let resolveFirstChallenge;
        const firstChallenge = new Promise((resolve) => {
            resolveFirstChallenge = resolve;
        });
        const flow = {
            id,
            client,
            existingAccount,
            phoneNumber: existingAccount?.phone || phoneNumber.trim(),
            pendingInput: null,
            resolveFirstChallenge,
            cancelled: false,
            state: { status: "connecting", accountId: id, phoneNumber: existingAccount?.phone || phoneNumber.trim(), step: null, error: null },
        };
        this.flow = flow;
        this.notice = null;

        const requestInput = (step) => new Promise((resolve, reject) => {
            if (this.flow !== flow || flow.cancelled) {
                reject(new Error("Telegram sign-in was cancelled."));
                return;
            }
            flow.pendingInput = { resolve, reject };
            flow.state = { ...flow.state, status: "awaiting_input", step, error: null };
            flow.resolveFirstChallenge(flow.state);
        });

        const startPromise = client.start({
            phoneNumber: () => flow.phoneNumber || requestInput("phone"),
            phoneCode: () => requestInput("code"),
            password: () => requestInput("password"),
            emailAddress: () => requestInput("email"),
            emailVerification: () => requestInput("email_code"),
        }).then(async () => {
            if (flow.cancelled || this.flow !== flow) {
                await client.disconnect();
                return;
            }
            const user = await client.getMe();
            const account = this.#accountDetails(id, user, flow.phoneNumber, numericApiId, savedApiHash);
            await this.#saveSession(id, client.session.save());
            this.accounts.set(id, account);
            await this.#saveAccounts();
            if (this.flow === flow && !flow.cancelled) {
                this.clients.set(id, client);
                this.flow = null;
                this.notice = null;
                await this.#recordActivityLog({
                    type: "account.connected",
                    level: "success",
                    message: "Аккаунт Telegram подключён.",
                    accountId: id,
                    accountName: this.#accountDisplayName(account),
                });
            } else {
                await client.disconnect();
            }
        }).catch(async (error) => {
            try {
                await client.disconnect();
            } catch (disconnectError) {
                console.error("Could not disconnect Telegram client:", disconnectError.name || "Error");
            }
            try {
                if (flow.existingAccount) {
                    this.accounts.set(id, flow.existingAccount);
                } else {
                    await this.#removeSession(id);
                    this.accounts.delete(id);
                }
            } catch (cleanupError) {
                console.error("Could not clean up failed Telegram sign-in:", cleanupError.name || "Error");
            }
            if (this.flow === flow && !flow.cancelled) {
                flow.state = {
                    ...flow.state,
                    status: "error",
                    step: null,
                    error: "Вход не выполнен. Проверьте данные и попробуйте снова.",
                };
                this.notice = { ...flow.state };
                this.flow = null;
                console.error("Telegram sign-in failed:", error.name || "Error");
                await this.#recordActivityLog({
                    type: "account.connection_failed",
                    level: "error",
                    message: "Не удалось подключить аккаунт Telegram.",
                    accountId: id,
                    accountName: existingAccount ? this.#accountDisplayName(existingAccount) : "Telegram account",
                });
            }
        });

        await Promise.race([firstChallenge, startPromise.then(() => null)]);
        return this.list();
    }

    submitInput(value) {
        if (typeof value !== "string" || !value.trim()) {
            throw requestError("Enter the requested Telegram verification value.");
        }
        if (!this.flow?.pendingInput) {
            throw requestError("Telegram is not waiting for a verification value.", 409);
        }

        const { resolve } = this.flow.pendingInput;
        this.flow.pendingInput = null;
        this.flow.state = { ...this.flow.state, status: "verifying", step: null, error: null };
        resolve(value.trim());
        return this.flow.state;
    }

    async cancelLogin() {
        const flow = this.flow;
        if (!flow) {
            this.notice = null;
            return this.list();
        }
        this.flow = null;
        this.notice = null;
        flow.cancelled = true;
        flow.pendingInput?.reject(new Error("Telegram sign-in was cancelled."));
        flow.pendingInput = null;
        await flow.client.disconnect();
        if (!flow.existingAccount) {
            await this.#removeSession(flow.id);
        }
        return this.list();
    }

    async disconnect(accountId) {
        await this.#initialize();
        const account = this.#getAccount(accountId);
        if (this.flow?.id === accountId) {
            throw requestError("Cancel the sign-in before disconnecting this account.", 409);
        }
        let changedSchedules = false;
        for (const schedule of this.schedules.values()) {
            if (schedule.accountId === accountId && schedule.running) {
                this.#stopSchedule(schedule, "The Telegram account was disconnected.");
                changedSchedules = true;
            }
        }
        if (changedSchedules) {
            await this.#saveSchedules();
        }
        const client = this.clients.get(accountId);
        if (client) {
            await client.disconnect();
            this.clients.delete(accountId);
        }
        await this.#recordActivityLog({
            type: "account.disconnected",
            level: "info",
            message: "Аккаунт Telegram отключён.",
            accountId,
            accountName: this.#accountDisplayName(account),
        });
        return { ...(await this.list()), disconnectedAccountId: account.id };
    }

    async listGroups(accountId) {
        await this.#initialize();
        this.#getAccount(accountId);
        const client = this.clients.get(accountId);
        if (!client?.connected) {
            throw requestError("Connect this Telegram account before loading its groups.", 409);
        }

        const dialogs = await client.getDialogs({ limit: 500 });
        return {
            groups: dialogs
                .filter((dialog) => dialog.isGroup)
                .map((dialog) => ({ id: dialog.id.toString(), title: dialog.title || dialog.name || "Telegram group" })),
        };
    }

    async listSavedMessages(accountId) {
        await this.#initialize();
        this.#getAccount(accountId);
        const client = this.clients.get(accountId);
        if (!client?.connected) {
            throw requestError("Connect this Telegram account before loading its Saved Messages.", 409);
        }

        const messages = await client.getMessages("me", { limit: 100 });
        return {
            messages: messages
                .filter((message) => typeof message.message === "string" && message.message.trim())
                .map((message) => ({
                    id: String(message.id),
                    text: message.message,
                    date: message.date || 0,
                })),
        };
    }

    async sendNotification({ accountId, groupId, message } = {}) {
        await this.#initialize();
        this.#getAccount(accountId);
        const client = this.clients.get(accountId);
        if (!client?.connected) {
            throw requestError("Connect this Telegram account before sending a notification.", 409);
        }
        if (typeof groupId !== "string" || !/^-?\d+$/.test(groupId) || groupId.length > 32) {
            throw requestError("Select a valid Telegram group.");
        }
        if (typeof message !== "string" || !message.trim() || message.length > 4096) {
            throw requestError("Enter a notification of up to 4096 characters.");
        }

        let dialogs;
        try {
            dialogs = await client.getDialogs({ limit: 500 });
        } catch (error) {
            console.error(`Could not load Telegram groups for account ${accountId}:`, error.name || "Error", error.message);
            await this.#recordActivityLog({
                type: "message.send_failed",
                level: "error",
                message: "Не удалось загрузить список групп перед отправкой.",
                accountId,
                accountName: this.#accountDisplayName(this.accounts.get(accountId)),
                groupId,
            });
            throw requestError(`Не удалось загрузить список групп Telegram: ${error.message || "неизвестная ошибка Telegram."}`, 502);
        }
        const group = dialogs.find((dialog) => dialog.isGroup && dialog.id.toString() === groupId);
        if (!group) {
            throw requestError("The selected group is no longer available for this account.", 404);
        }

        let sentMessage;
        try {
            sentMessage = await group.send({
                message: message.trim(),
                parseMode: false,
            });
        } catch (error) {
            console.error(`Telegram rejected a message to group ${groupId}:`, error.name || "Error", error.message);
            await this.#recordActivityLog({
                type: "message.send_failed",
                level: "error",
                message: `Не удалось отправить сообщение в «${group.title || group.name || "группу Telegram"}».`,
                accountId,
                accountName: this.#accountDisplayName(this.accounts.get(accountId)),
                groupId,
                groupTitle: group.title || group.name || "Telegram group",
            });
            throw requestError(`Telegram не отправил сообщение: ${error.message || "неизвестная ошибка Telegram."}`, 502);
        }
        await this.#recordActivityLog({
            type: "message.sent",
            level: "success",
            message: `Сообщение отправлено в «${group.title || group.name || "группу Telegram"}».`,
            accountId,
            accountName: this.#accountDisplayName(this.accounts.get(accountId)),
            groupId,
            groupTitle: group.title || group.name || "Telegram group",
        });
        return { sent: true, groupTitle: group.title || group.name || "Telegram group", messageId: sentMessage.id };
    }

    async listNotificationSchedules() {
        await this.#initialize();
        return { schedules: [...this.schedules.values()].map((schedule) => this.#publicSchedule(schedule)) };
    }

    async addNotificationSchedule({ accountId, groupId, messages, intervalMinutes } = {}) {
        await this.#initialize();
        const { account, group, normalizedMessages } = await this.#validateScheduleConfig({
            accountId, groupId, messages, intervalMinutes,
        });
        const accountDisplayName = [account.firstName, account.lastName].filter(Boolean).join(" ")
            || (account.username ? `@${account.username}` : account.phone);
        const now = Date.now();
        const schedule = {
            id: randomUUID(),
            accountId,
            accountName: accountDisplayName,
            accountPhone: account.phone,
            groupId,
            groupTitle: group.title || group.name || "Telegram group",
            messages: normalizedMessages,
            intervalMinutes,
            messageIndex: 0,
            sentCount: 0,
            running: false,
            createdAt: now,
            startedAt: null,
            nextSendAt: null,
            lastSentAt: null,
            error: null,
        };
        this.schedules.set(schedule.id, schedule);
        try {
            await this.#saveSchedules();
        } catch (error) {
            this.schedules.delete(schedule.id);
            throw error;
        }
        await this.#recordActivityLog({
            type: "schedule.created",
            level: "info",
            message: `Создано расписание для «${schedule.groupTitle}» (каждые ${intervalMinutes} мин.).`,
            accountId,
            accountName: schedule.accountName,
            groupId,
            groupTitle: schedule.groupTitle,
            scheduleId: schedule.id,
        });
        return { schedule: this.#publicSchedule(schedule) };
    }

    async startNotificationSchedule(scheduleId) {
        await this.#initialize();
        const schedule = this.#getSchedule(scheduleId);
        if (schedule.running) {
            throw requestError("This notification schedule is already running.", 409);
        }
        const { group } = await this.#validateScheduleConfig(schedule);
        schedule.groupTitle = group.title || group.name || schedule.groupTitle;
        schedule.running = true;
        schedule.startedAt = Date.now();
        schedule.nextSendAt = schedule.startedAt + schedule.intervalMinutes * 60 * 1000;
        schedule.error = null;
        try {
            await this.#saveSchedules();
        } catch (error) {
            schedule.running = false;
            schedule.nextSendAt = null;
            throw error;
        }
        this.#scheduleNextMessage(schedule);
        await this.#recordActivityLog({
            type: "schedule.started",
            level: "success",
            message: `Запущено расписание для «${schedule.groupTitle}».`,
            accountId: schedule.accountId,
            accountName: schedule.accountName,
            groupId: schedule.groupId,
            groupTitle: schedule.groupTitle,
            scheduleId: schedule.id,
        });
        return { schedule: this.#publicSchedule(schedule) };
    }

    async stopNotificationSchedule(scheduleId) {
        await this.#initialize();
        const schedule = this.#getSchedule(scheduleId);
        const previousState = {
            running: schedule.running,
            nextSendAt: schedule.nextSendAt,
            stoppedAt: schedule.stoppedAt,
        };
        this.#stopSchedule(schedule);
        try {
            await this.#saveSchedules();
        } catch (error) {
            Object.assign(schedule, previousState);
            if (schedule.running) {
                this.#scheduleNextMessage(schedule, Math.max(0, (schedule.nextSendAt || Date.now()) - Date.now()));
            }
            throw error;
        }
        await this.#recordActivityLog({
            type: "schedule.stopped",
            level: "info",
            message: `Остановлено расписание для «${schedule.groupTitle}».`,
            accountId: schedule.accountId,
            accountName: schedule.accountName,
            groupId: schedule.groupId,
            groupTitle: schedule.groupTitle,
            scheduleId: schedule.id,
        });
        return { schedule: this.#publicSchedule(schedule) };
    }

    async removeNotificationSchedule(scheduleId) {
        await this.#initialize();
        const schedule = this.#getSchedule(scheduleId);
        const previousState = {
            running: schedule.running,
            nextSendAt: schedule.nextSendAt,
            stoppedAt: schedule.stoppedAt,
        };
        this.#stopSchedule(schedule);
        this.schedules.delete(scheduleId);
        try {
            await this.#saveSchedules();
        } catch (error) {
            this.schedules.set(scheduleId, schedule);
            Object.assign(schedule, previousState);
            if (schedule.running) {
                this.#scheduleNextMessage(schedule, Math.max(0, (schedule.nextSendAt || Date.now()) - Date.now()));
            }
            throw error;
        }
        await this.#recordActivityLog({
            type: "schedule.deleted",
            level: "info",
            message: `Удалено расписание для «${schedule.groupTitle}».`,
            accountId: schedule.accountId,
            accountName: schedule.accountName,
            groupId: schedule.groupId,
            groupTitle: schedule.groupTitle,
            scheduleId: schedule.id,
        });
        return { removedScheduleId: scheduleId };
    }

    async remove(accountId) {
        await this.#initialize();
        const account = this.#getAccount(accountId);
        if (this.flow?.id === accountId) {
            throw requestError("Cancel the sign-in before removing this account.", 409);
        }
        const client = this.clients.get(accountId);
        for (const schedule of this.schedules.values()) {
            if (schedule.accountId === accountId && schedule.running) {
                this.#stopSchedule(schedule, "The Telegram account was removed.");
            }
        }
        await this.#saveSchedules();
        let logoutConfirmed = null;
        if (client) {
            logoutConfirmed = await client.logOut();
            this.clients.delete(accountId);
        }
        await this.#removeSession(accountId);
        this.accounts.delete(accountId);
        await this.#saveAccounts();
        await this.#recordActivityLog({
            type: "account.removed",
            level: "info",
            message: "Аккаунт Telegram удалён.",
            accountId,
            accountName: [account.firstName, account.lastName].filter(Boolean).join(" ") || "Telegram account",
        });
        return { ...(await this.list()), removedAccountId: accountId, logoutConfirmed };
    }

    #accountDisplayName(account) {
        return [account?.firstName, account?.lastName].filter(Boolean).join(" ")
            || (account?.username ? `@${account.username}` : "Telegram account");
    }

    async #recordActivityLog(entry) {
        const log = {
            id: randomUUID(),
            timestamp: Date.now(),
            type: entry.type,
            level: entry.level,
            message: entry.message,
            ...(entry.accountId ? { accountId: entry.accountId } : {}),
            ...(entry.accountName ? { accountName: entry.accountName } : {}),
            ...(entry.groupId ? { groupId: entry.groupId } : {}),
            ...(entry.groupTitle ? { groupTitle: entry.groupTitle } : {}),
            ...(entry.scheduleId ? { scheduleId: entry.scheduleId } : {}),
        };
        this.activityLogs.unshift(log);
        this.activityLogs = this.activityLogs.slice(0, maximumActivityLogs);
        try {
            await this.#saveActivityLogs();
        } catch (error) {
            console.error("Could not save activity log:", error.name || "Error", error.message);
        }
    }

    async #loadActivityLogs() {
        try {
            const contents = await fs.readFile(activityLogPath, "utf8");
            const logs = JSON.parse(contents);
            if (!Array.isArray(logs) || logs.some((log) => (
                !log
                || typeof log.id !== "string"
                || !Number.isSafeInteger(log.timestamp)
                || typeof log.type !== "string"
                || typeof log.level !== "string"
                || !["info", "success", "error"].includes(log.level)
                || typeof log.message !== "string"
            ))) {
                throw new Error("Saved activity log data is invalid.");
            }
            this.activityLogs = logs.slice(0, maximumActivityLogs);
            await fs.chmod(activityLogPath, 0o600);
        } catch (error) {
            if (error.code === "ENOENT") {
                return;
            }
            throw error;
        }
    }

    async #saveActivityLogs() {
        const snapshot = JSON.stringify(this.activityLogs, null, 2);
        const save = this.activityLogSave.catch(() => {}).then(async () => {
            await fs.mkdir(sessionsPath, { recursive: true, mode: 0o700 });
            await fs.chmod(sessionsPath, 0o700);
            const temporaryPath = `${activityLogPath}.${process.pid}.${randomUUID()}.tmp`;
            await fs.writeFile(temporaryPath, snapshot, { encoding: "utf8", mode: 0o600 });
            await fs.chmod(temporaryPath, 0o600);
            await fs.rename(temporaryPath, activityLogPath);
        });
        this.activityLogSave = save;
        await save;
    }

    async #validateScheduleConfig({ accountId, groupId, messages, intervalMinutes } = {}) {
        const account = this.#getAccount(accountId);
        if (!Number.isSafeInteger(intervalMinutes)
            || intervalMinutes < minimumScheduleIntervalMinutes
            || intervalMinutes > maximumScheduleIntervalMinutes) {
            throw requestError("Set the schedule interval to a whole number between 1 and 1440 minutes.");
        }
        if (!this.clients.get(accountId)?.connected) {
            throw requestError("Connect this Telegram account before starting a schedule.", 409);
        }
        if (typeof groupId !== "string" || !/^-?\d+$/.test(groupId) || groupId.length > 32) {
            throw requestError("Select a valid Telegram group.");
        }
        if (!Array.isArray(messages) || messages.length === 0 || messages.length > 100) {
            throw requestError("Select between 1 and 100 favorite messages.");
        }
        const normalizedMessages = messages.map((message) => {
            if (typeof message !== "string" || !message.trim() || message.length > 4096) {
                throw requestError("Favorite messages must contain 1 to 4096 characters.");
            }
            return message.trim();
        });

        const client = this.clients.get(accountId);
        const dialogs = await client.getDialogs({ limit: 500 });
        const group = dialogs.find((dialog) => dialog.isGroup && dialog.id.toString() === groupId);
        if (!group) {
            throw requestError("The selected group is no longer available for this account.", 404);
        }
        return { account, group, normalizedMessages };
    }

    #getSchedule(scheduleId) {
        if (typeof scheduleId !== "string" || !scheduleIdPattern.test(scheduleId)) {
            throw requestError("Invalid notification schedule ID.");
        }
        const schedule = this.schedules.get(scheduleId);
        if (!schedule) {
            throw requestError("Notification schedule was not found.", 404);
        }
        return schedule;
    }

    #scheduleNextMessage(schedule, delay = schedule.intervalMinutes * 60 * 1000) {
        const timer = setTimeout(async () => {
            this.scheduleTimers.delete(schedule.id);
            if (this.schedules.get(schedule.id) !== schedule || !schedule.running) {
                return;
            }
            try {
                await this.sendNotification({
                    accountId: schedule.accountId,
                    groupId: schedule.groupId,
                    message: schedule.messages[schedule.messageIndex],
                });
                if (this.schedules.get(schedule.id) !== schedule || !schedule.running) {
                    return;
                }
                schedule.sentCount += 1;
                schedule.messageIndex = (schedule.messageIndex + 1) % schedule.messages.length;
                schedule.lastSentAt = Date.now();
                schedule.nextSendAt = Date.now() + schedule.intervalMinutes * 60 * 1000;
                await this.#saveSchedules();
                this.#scheduleNextMessage(schedule);
            } catch (error) {
                console.error("Recurring Telegram notification failed:", error.name || "Error", error.message);
                this.#stopSchedule(schedule, error.message || "Telegram could not send the scheduled message.");
                await this.#saveSchedules();
                await this.#recordActivityLog({
                    type: "schedule.failed",
                    level: "error",
                    message: `Расписание остановлено из-за ошибки отправки в «${schedule.groupTitle}».`,
                    accountId: schedule.accountId,
                    accountName: schedule.accountName,
                    groupId: schedule.groupId,
                    groupTitle: schedule.groupTitle,
                    scheduleId: schedule.id,
                });
            }
        }, delay);
        this.scheduleTimers.set(schedule.id, timer);
    }

    #stopSchedule(schedule, error = null) {
        const timer = this.scheduleTimers.get(schedule.id);
        if (timer) {
            clearTimeout(timer);
            this.scheduleTimers.delete(schedule.id);
        }
        schedule.running = false;
        schedule.nextSendAt = null;
        schedule.stoppedAt = Date.now();
        if (error) {
            schedule.error = error;
        }
    }

    async #loadSchedules() {
        try {
            const contents = await fs.readFile(schedulesPath, "utf8");
            const schedules = JSON.parse(contents);
            if (!Array.isArray(schedules) || schedules.some((schedule) => (
                !schedule
                || !scheduleIdPattern.test(schedule.id)
                || !accountIdPattern.test(schedule.accountId)
                || typeof schedule.accountName !== "string"
                || typeof schedule.accountPhone !== "string"
                || typeof schedule.groupId !== "string"
                || !/^-?\d+$/.test(schedule.groupId)
                || typeof schedule.groupTitle !== "string"
                || !Array.isArray(schedule.messages)
                || schedule.messages.length === 0
                || schedule.messages.length > 100
                || schedule.messages.some((message) => (
                    typeof message !== "string" || !message.trim() || message.length > 4096
                ))
                || !Number.isSafeInteger(schedule.intervalMinutes)
                || schedule.intervalMinutes < minimumScheduleIntervalMinutes
                || schedule.intervalMinutes > maximumScheduleIntervalMinutes
                || !Number.isSafeInteger(schedule.messageIndex)
                || schedule.messageIndex < 0
                || schedule.messageIndex >= schedule.messages.length
                || !Number.isSafeInteger(schedule.sentCount)
                || schedule.sentCount < 0
                || typeof schedule.running !== "boolean"
                || !Number.isSafeInteger(schedule.createdAt)
            ))) {
                throw new Error("Saved notification schedule data is invalid.");
            }
            for (const schedule of schedules) {
                this.schedules.set(schedule.id, {
                    ...schedule,
                    startedAt: Number.isSafeInteger(schedule.startedAt) ? schedule.startedAt : null,
                    nextSendAt: Number.isSafeInteger(schedule.nextSendAt) ? schedule.nextSendAt : null,
                    lastSentAt: Number.isSafeInteger(schedule.lastSentAt) ? schedule.lastSentAt : null,
                    error: typeof schedule.error === "string" ? schedule.error : null,
                });
            }
            await fs.chmod(schedulesPath, 0o600);
        } catch (error) {
            if (error.code === "ENOENT") {
                return;
            }
            throw error;
        }
    }

    async #resumeSavedSchedules() {
        let changed = false;
        for (const schedule of this.schedules.values()) {
            if (!schedule.running) {
                continue;
            }
            if (!this.clients.get(schedule.accountId)?.connected) {
                this.#stopSchedule(schedule, "The Telegram account could not reconnect after the server restarted.");
                changed = true;
                continue;
            }
            if (!schedule.nextSendAt) {
                schedule.nextSendAt = Date.now() + schedule.intervalMinutes * 60 * 1000;
                changed = true;
            }
            const delay = Math.max(0, (schedule.nextSendAt || Date.now()) - Date.now());
            this.#scheduleNextMessage(schedule, delay);
        }
        if (changed) {
            await this.#saveSchedules();
        }
    }

    #publicSchedule(schedule) {
        const { messages, messageIndex, ...publicSchedule } = schedule;
        return { ...publicSchedule, messageCount: messages.length };
    }

    async #initialize() {
        if (!this.initialized) {
            this.initialized = this.#loadAccounts()
                .then(() => this.#loadActivityLogs())
                .then(() => this.#reconnectSavedAccounts())
                .then(() => this.#loadSchedules())
                .then(() => this.#resumeSavedSchedules());
        }
        return this.initialized;
    }

    async #reconnectSavedAccounts() {
        for (const account of this.accounts.values()) {
            if (!account.apiHash) continue;

            let client;
            try {
                if (!await this.#sessionExists(account.id)) continue;
                client = new TelegramClient(
                    new StringSession(await this.#loadSession(account.id)),
                    account.apiId,
                    account.apiHash,
                    { connectionRetries: 5 },
                );
                await client.connect();
                if (!await client.checkAuthorization()) {
                    await client.disconnect();
                    continue;
                }
                this.clients.set(account.id, client);
                await this.#recordActivityLog({
                    type: "account.reconnected",
                    level: "success",
                    message: "Аккаунт Telegram переподключён после запуска сервера.",
                    accountId: account.id,
                    accountName: this.#accountDisplayName(account),
                });
            } catch (error) {
                await client?.disconnect().catch(() => {});
                console.error(`Could not reconnect Telegram account ${account.id}:`, error.name || "Error");
                await this.#recordActivityLog({
                    type: "account.reconnect_failed",
                    level: "error",
                    message: "Не удалось переподключить аккаунт Telegram после запуска сервера.",
                    accountId: account.id,
                    accountName: this.#accountDisplayName(account),
                });
            }
        }
    }

    async #loadAccounts() {
        try {
            const contents = await fs.readFile(accountsPath, "utf8");
            const accounts = JSON.parse(contents);
            if (!Array.isArray(accounts) || accounts.some((account) => (
                !account
                || !accountIdPattern.test(account.id)
                || typeof account.phone !== "string"
                || !Number.isSafeInteger(account.apiId)
                || account.apiId <= 0
                || (account.apiHash !== undefined && (
                    typeof account.apiHash !== "string"
                    || !/^[a-f0-9]{32}$/i.test(account.apiHash)
                ))
            ))) {
                throw new Error("Saved Telegram account data is invalid.");
            }
            for (const account of accounts) {
                this.accounts.set(account.id, {
                    id: account.id,
                    phone: account.phone,
                    firstName: typeof account.firstName === "string" ? account.firstName : "",
                    lastName: typeof account.lastName === "string" ? account.lastName : "",
                    username: typeof account.username === "string" ? account.username : "",
                    apiId: account.apiId,
                    ...(account.apiHash ? { apiHash: account.apiHash } : {}),
                });
            }
            await fs.chmod(accountsPath, 0o600);
        } catch (error) {
            if (error.code === "ENOENT") {
                return;
            }
            throw error;
        }
    }

    #getAccount(accountId) {
        if (typeof accountId !== "string" || !accountIdPattern.test(accountId)) {
            throw requestError("Invalid Telegram account ID.");
        }
        const account = this.accounts.get(accountId);
        if (!account) {
            throw requestError("Telegram account was not found.", 404);
        }
        return account;
    }

    #accountDetails(id, user, fallbackPhone, apiId, apiHash) {
        const firstName = typeof user.firstName === "string" ? user.firstName : "";
        const lastName = typeof user.lastName === "string" ? user.lastName : "";
        return {
            id,
            phone: user.phone || fallbackPhone,
            firstName,
            lastName,
            username: typeof user.username === "string" ? user.username : "",
            apiId,
            apiHash,
        };
    }

    async #sessionExists(id) {
        try {
            await fs.access(this.#sessionFile(id));
            return true;
        } catch (error) {
            if (error.code === "ENOENT") {
                return false;
            }
            throw error;
        }
    }

    #sessionFile(id) {
        if (!accountIdPattern.test(id)) {
            throw requestError("Invalid Telegram account ID.");
        }
        return path.join(sessionsPath, `${id}.session`);
    }

    async #loadSession(id) {
        const sessionFile = this.#sessionFile(id);
        const session = await fs.readFile(sessionFile, "utf8");
        await fs.chmod(sessionFile, 0o600);
        return session.trim();
    }

    async #saveSession(id, session) {
        if (typeof session !== "string" || !session) {
            throw new Error("Telegram returned an empty session.");
        }
        await fs.mkdir(sessionsPath, { recursive: true, mode: 0o700 });
        await fs.chmod(sessionsPath, 0o700);
        const sessionFile = this.#sessionFile(id);
        const temporaryPath = `${sessionFile}.${process.pid}.tmp`;
        await fs.writeFile(temporaryPath, session, { encoding: "utf8", mode: 0o600 });
        await fs.chmod(temporaryPath, 0o600);
        await fs.rename(temporaryPath, sessionFile);
    }

    async #removeSession(id) {
        try {
            await fs.unlink(this.#sessionFile(id));
        } catch (error) {
            if (error.code !== "ENOENT") {
                throw error;
            }
        }
    }

    async #saveAccounts() {
        await fs.mkdir(sessionsPath, { recursive: true, mode: 0o700 });
        await fs.chmod(sessionsPath, 0o700);
        const temporaryPath = `${accountsPath}.${process.pid}.tmp`;
        await fs.writeFile(temporaryPath, JSON.stringify([...this.accounts.values()], null, 2), {
            encoding: "utf8",
            mode: 0o600,
        });
        await fs.chmod(temporaryPath, 0o600);
        await fs.rename(temporaryPath, accountsPath);
    }

    async #saveSchedules() {
        const snapshot = JSON.stringify([...this.schedules.values()], null, 2);
        const save = this.scheduleSave.catch(() => {}).then(async () => {
            await fs.mkdir(sessionsPath, { recursive: true, mode: 0o700 });
            await fs.chmod(sessionsPath, 0o700);
            const temporaryPath = `${schedulesPath}.${process.pid}.${randomUUID()}.tmp`;
            await fs.writeFile(temporaryPath, snapshot, { encoding: "utf8", mode: 0o600 });
            await fs.chmod(temporaryPath, 0o600);
            await fs.rename(temporaryPath, schedulesPath);
        });
        this.scheduleSave = save;
        await save;
    }
}

module.exports = Telegram;
