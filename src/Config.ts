import fs from 'fs/promises'

export default class Config {
    private static _config: IConfig

    /**
     * Load the config from disk, or cache if already loaded.
     */
    static async get(): Promise<IConfig> {
        if (this._config) return this._config
        const localConfigBuffer = await fs.readFile('./config.local.json')
        if (localConfigBuffer) {
            this._config = JSON.parse(localConfigBuffer.toString())
        } else {
            const configBuffer = await fs.readFile('./config.json')
            if (configBuffer) this._config = JSON.parse(configBuffer.toString())
        }
        return this._config
    }
}

/**
 * The configuration stored on file as config.json or config.local.json.
 */
export interface IConfig {
    clientId: string
    clientSecret: string
    token: string
    serverId: string
    serverAddress: string
    timeoutMins: number
    botUserName: string
    progressBarSymbols: string[]
    progressBarFiller: string
    spamMaxBatchSize: number
    spamThreadThreshold: number
    variationStrength: number
    maxPromptSizeInResponse: number
    samplerName: string
    stepCountBase: number
    stepCountDetailMultiplier: number,
    stepCountTextMultiplier: number,
    imageCountForTextGenerations: number
}