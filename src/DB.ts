import sqlite3 from 'sqlite3'
import {Database, open} from 'sqlite'
import fs from 'fs/promises'
import {IStringDictionary} from './Utils.js'

/**
 * Class that handles database operations.
 */
export default class DB {
    constructor() {
        const dir = './db'
        fs.access(dir)
            .then(() => console.log('DB directory exists'))
            .catch(() => {
                fs.mkdir('./db')
                    .then(() => console.log('DB directory created'))
                    .catch((err) => console.error('Unable to create DB directory', err))
            })
    }

    private _db: Database<sqlite3.Database> | undefined = undefined

    private async getDb(): Promise<Database<sqlite3.Database> | undefined> {
        if (!this._db) {
            this._db = await open({
                filename: './db/stabled_bot.db',
                driver: sqlite3.Database
            })
            // this._db.on('trace', (data) => {
            //     console.log('SQL Trace:', data)
            // })
        }
        return this._db
    }

    // region Spam Threads
    private async ensureSpamThreadsTable() {
        const db = await this.getDb()
        await db.exec('CREATE TABLE IF NOT EXISTS spam_threads (id INTEGER PRIMARY KEY, channel_id TEXT UNIQUE)')
    }

    async registerSpamThread(channelId: string): Promise<boolean> {
        const db = await this.getDb()
        if (db) {
            await this.ensureSpamThreadsTable()
            const stmt = await db.prepare('INSERT OR IGNORE INTO spam_threads (channel_id) VALUES (?)')
            const result = await stmt.run(channelId)
            if (result.lastID) return true
        }
        return false
    }

    async isSpamThread(channelId: string): Promise<boolean> {
        const db = await this.getDb()
        if (db) {
            await this.ensureSpamThreadsTable()
            const result = await db.get('SELECT * FROM spam_threads WHERE channel_id = ?', channelId)
            if (result) return true
        }
        return false
    }

    async unregisterSpamThread(channelId: string): Promise<boolean> {
        const db = await this.getDb()
        if (db) {
            await this.ensureSpamThreadsTable()
            const result = await db.run('DELETE FROM spam_threads WHERE channel_id = ?', channelId)
            if (result.changes > 0) return true
        }
        return false
    }

    // endregion

    // region User Settings
    private async ensureUserSettingsTable() {
        const db = await this.getDb()
        await db.exec('CREATE TABLE IF NOT EXISTS user_settings (id INTEGER PRIMARY KEY, user_id TEXT, setting TEXT, value TEXT)')
        await db.exec('CREATE UNIQUE INDEX IF NOT EXISTS user_settings_index ON user_settings (user_id, setting)')
    }
    async setUserSetting(userId: string, setting: string, value: string): Promise<boolean> {
        const db = await this.getDb()
        if (db) {
            await this.ensureUserSettingsTable()
            const stmt = await db.prepare('INSERT OR REPLACE INTO user_settings (user_id, setting, value) VALUES (?, ?, ?)')
            const result = await stmt.run(userId, setting, value)
            if (result.lastID) return true
        }
        return false
    }
    async getUserSetting(userId: string, setting: string): Promise<string | undefined> {
        const db = await this.getDb()
        if (db) {
            await this.ensureUserSettingsTable()
            const result = await db.get('SELECT value FROM user_settings WHERE user_id = ? AND setting = ?', userId, setting)
            if (result) return result.value
        }
        return undefined
    }
    async getAllUserSettings(userId): Promise<IStringDictionary> {
        const db = await this.getDb()
        if (db) {
            await this.ensureUserSettingsTable()
            const result = await db.all('SELECT setting, value FROM user_settings WHERE user_id = ?', userId)
            const settings: IStringDictionary = {}
            for (const row of result) {
                settings[row.setting] = row.value
            }
            return settings
        }
        return {}
    }
    // endregion

    // region User Params
    private async ensureUserParamsTable() {
        const db = await this.getDb()
        await db.exec('CREATE TABLE IF NOT EXISTS user_params (id INTEGER PRIMARY KEY, user_id TEXT, name TEXT, value TEXT)')
        await db.exec('CREATE UNIQUE INDEX IF NOT EXISTS user_params_index ON user_params (user_id, name)')
    }

    async setUserParam(userId: string, name: string, value: string): Promise<boolean> {
        const db = await this.getDb()
        if (db) {
            await this.ensureUserParamsTable()
            const stmt = await db.prepare('INSERT OR REPLACE INTO user_params (user_id, name, value) VALUES (?, ?, ?)')
            const result = await stmt.run(userId, name, value)
            if (result.lastID) return true
        }
        return false
    }

    async getUserParam(userId: string, name: string): Promise<string | undefined> {
        const db = await this.getDb()
        if (db) {
            await this.ensureUserParamsTable()
            const result = await db.get('SELECT value FROM user_params WHERE user_id = ? AND name = ?', userId, name)
            if (result) return result.value
        }
        return undefined
    }

    async getAllUserParams(userId: string): Promise<IStringDictionary> {
        const db = await this.getDb()
        if (db) {
            await this.ensureUserParamsTable()
            const result = await db.all('SELECT name, value FROM user_params WHERE user_id = ?', userId)
            const params: IStringDictionary = {}
            for (const row of result) {
                params[row.name] = row.value
            }
            return params
        }
        return {}
    }

    async deleteUserParam(userId: string, name: string): Promise<boolean> {
        const db = await this.getDb()
        if (db) {
            await this.ensureUserParamsTable()
            const result = await db.run('DELETE FROM user_params WHERE user_id = ? AND name = ?', userId, name)
            if (result.changes > 0) return true
        }
        return false
    }
    // endregion
}