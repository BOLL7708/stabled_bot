import sqlite3 from 'sqlite3'
import {Database, open} from 'sqlite'
import fs from 'fs/promises'

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
            this._db.on('trace', (data) => {
                console.log('SQL Trace:', data)
            })
        }
        return this._db
    }

    // region Prompts
    private async ensureSpamThreadsTable() {
        const db = await this.getDb()
        await db.exec('CREATE TABLE IF NOT EXISTS spam_threads (id INTEGER PRIMARY KEY, channel_id TEXT UNIQUE)')
    }

    async registerSpamThread(channelId: string) {
        const db = await this.getDb()
        if (db) {
            await this.ensureSpamThreadsTable()
            const stmt = await db.prepare('INSERT INTO spam_threads (channel_id) VALUES (?)')
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

    // endregion
}