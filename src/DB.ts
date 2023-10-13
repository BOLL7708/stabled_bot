import sqlite3 from 'sqlite3'
import {Database, open} from 'sqlite'
import fs from 'fs/promises'
import {IConfig} from './Config.js'

/**
 * Class that handles database operations.
 */
export default class DB {
    constructor(private _config: IConfig) {
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

    // region Prompts
    private async ensurePromptsTable() {
        const db = await this.getDb()
        await db.exec('CREATE TABLE IF NOT EXISTS prompts (id INTEGER PRIMARY KEY, reference TEXT UNIQUE, prompt TEXT, negative_prompt TEXT, aspect_ratio TEXT, count NUMBER, user TEXT, message_id TEXT)')
    }

    async registerPrompt(reference: string, prompt: string, negativePrompt: string, aspect_ratio: string, count: number, user: string, messageId: string) {
        const db = await this.getDb()
        if (db) {
            await this.ensurePromptsTable()
            const stmt = await db.prepare('INSERT INTO prompts (reference, prompt, negative_prompt, aspect_ratio, count, user, message_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
            const result = await stmt.run(reference, prompt, negativePrompt, aspect_ratio, count, user, messageId)
            if (result.lastID) return true
        }
        return false
    }

    async getPrompt(reference: string): Promise<IPromptRow|undefined> {
        const db = await this.getDb()
        if (db) {
            await this.ensurePromptsTable()
            return await db.get('SELECT * FROM prompts WHERE reference = ?', reference)
        }
        return undefined
    }
    async getPrompts(messageId: string): Promise<IPromptRow[]> {
        const db = await this.getDb()
        if (db) {
            await this.ensurePromptsTable()
            return await db.all('SELECT * FROM prompts WHERE message_id = ?', messageId)
        }
        return []
    }
    // endregion
}

export interface IPromptRow {
    id: number
    reference: string
    prompt: string
    negative_prompt: string
    aspect_ratio: string
    count: number
    user: string
    message_id: string
}