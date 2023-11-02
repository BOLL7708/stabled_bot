import Config from './Config.js'
import {ImageGenerationOptions} from './StabledAPI.js'

export default class Utils {
    static normalizeSize(arbitrarySize: string): string {
        const DEFAULT = '512x512'
        // Parse values
        const sizePair = arbitrarySize.split(/[^.\d]/)
        if (!sizePair || sizePair.length < 2) return DEFAULT
        const sizeWidth = Number(sizePair[0])
        const sizeHeight = Number(sizePair[1])
        if (isNaN(sizeWidth) || isNaN(sizeHeight) || sizeWidth == 0 || sizeHeight == 0) return DEFAULT

        // Output normalized size
        const aspectRatio = sizeWidth / sizeHeight
        const width = Math.round(Math.sqrt(aspectRatio * (512 * 512)))
        const height = Math.round(width / aspectRatio)
        return `${width}x${height}`
    }

    static getSerial(seed: number | string, subseed: number | string, count: number | string): string {
        const arr = [`${Date.now()}${count}`, seed.toString()]
        if (!!subseed) arr.push(subseed.toString())
        return arr.join('-')
    }

    static async progressBarMessage(index: number | undefined, value: number, steps: number): Promise<string> {
        const length = steps / 5
        const config = await Config.get()
        const indexStr = !!index
            ? ` on #${index}`
            : ''
        const symbols = config.progressBarSymbols
        const bar = Array.from({length}, (_, i) => i).map(i => symbols[i % symbols.length]) // Set the value of the array to the index
        const progress = Math.round(value * bar.length)
        return `🎪 Working${indexStr}: ${
            bar.slice(0, progress)
                .join('')}${config.progressBarFiller
            .repeat(bar.length - progress)
        } ${Math.round(value * 100)}%`
    }

    static log(title: string, value: string, byUser: string, color: string = Color.Reset, valueColor?: string) {
        if (!valueColor) valueColor = color
        console.log(`${color}${title} ${Color.Reset}[${valueColor}${value}${Color.Reset}] ${byUser}`)
    }

    static parsePNGInfo(info?: string): PngInfo {
        const MATCH_NEGATIVE_PROMPT = 'Negative prompt: '
        const MATCH_OPTIONS = 'Steps: '
        const pngInfo = new PngInfo()
        if (!info) return pngInfo

        const rows = info.split(/\n/g)
        let mode = 0
        const promptArr = []
        const negativePrompt = []
        let firstRow = true
        for (const row of rows) {
            if (row.startsWith(MATCH_NEGATIVE_PROMPT)) {
                mode = 1
                firstRow = true
            } else if (row.startsWith(MATCH_OPTIONS)) {
                mode = 2
                firstRow = true
            }
            switch (mode) {
                case 0:
                    promptArr.push(row)
                    break
                case 1:
                    if (firstRow) negativePrompt.push(row.replace(MATCH_NEGATIVE_PROMPT, ''))
                    else negativePrompt.push(row)
                    break
                case 2:
                    const pairs = row.split(/,/g)
                    for (const pair of pairs) {
                        const [label, value] = pair.split(':')
                        if (label) pngInfo[Utils.toCamelCase(label)] = value?.trim() ?? ''
                    }
                    break
            }
            firstRow = false
        }
        pngInfo.prompt = promptArr.join('\n')
        pngInfo.negativePrompt = negativePrompt.join('\n')
        return pngInfo
    }

    // Convert sentence to camelcase
    static toCamelCase(str: string): string {
        return str.trim().toLowerCase().replace(/\W+(.)/g, function (word, chr) {
            return chr.toUpperCase()
        })
            .replace(/\s+/g, '') // Remove whitespace
            .replace(/\W/g, '') // Remove non-word characters
    }

    static getImageOptionsFromInput(input: string): ImageGenerationOptions[] {
        /**
         * Recursive function that generates all the possible combinations of alt values.
         * @param input
         * @param existingMatch
         */
        function replaceAltArraysWithAlts(input: IPromptAltValues, existingMatch?: RegExpMatchArray): IPromptAltValues[] {
            // Go through incoming values, check for any
            const regexAlts = /\[(.*?)]/m
            const match = existingMatch ?? input.prompt.match(regexAlts)
            const result: IPromptAltValues[] = []
            if (match) {
                const [replaceStr, group] = match
                if (replaceStr && group) {
                    for (let alt of group.split(',')) {
                        alt = alt.trim()
                        const newPrompt = Utils.replaceSubstring(input.prompt, match.index, replaceStr.length, alt)
                        const newMatch = newPrompt.match(regexAlts)
                        const hints = [...input.hints, alt]
                        if (newMatch) {
                            const newResult = replaceAltArraysWithAlts({prompt: newPrompt, hints}, newMatch)
                            result.push(...newResult)
                        } else result.push({prompt: newPrompt, hints})
                    }
                } else {
                    result.push(input)
                }
            } else result.push(input)
            return result
        }

        const alternatives = replaceAltArraysWithAlts({prompt: input, hints: []})
        const result: ImageGenerationOptions[] = []
        for (const alt of alternatives) {
            let [altPrompt, negativePrompt] = alt.prompt.split(';')
            const sizeMatch = altPrompt.match(/\{([.\d]+.+[.\d]+)}/m)
            let size: string
            if (sizeMatch) {
                const [replaceStr, group] = sizeMatch
                altPrompt = this.replaceSubstring(altPrompt, sizeMatch.index, replaceStr.length, '')
                if (group) size = Utils.normalizeSize(group)
            }
            const newOptions = new ImageGenerationOptions()
            newOptions.prompt = altPrompt
            newOptions.promptHints = alt.hints
            if (negativePrompt?.length) newOptions.negativePrompt = negativePrompt
            if (size?.length) newOptions.size = size
            result.push(newOptions)
        }
        return result
    }

    static replaceSubstring(input: string, index: number, length: number, replacement: string) {
        const head = input.slice(0, index)
        const tail = input.slice(index + length)
        return head + replacement + tail;
    }
}

export class PngInfo {
    prompt = ''
    negativePrompt = ''
    steps: string = ''
    sampler: string = ''
    cfgScale: string = ''
    seed: string = ''
    faceRestoration: string = ''
    size: string = ''
    modelHash: string = ''
    model: string = ''
    denoisingStrength: string = ''
    version: string = ''
    variationSeed: string = ''
    variationSeedStrength: string = ''
    // TODO: Add more fields
}

export class Color {
    static Reset = "\x1b[0m"
    static Bright = "\x1b[1m"
    static Dim = "\x1b[2m"
    static Underscore = "\x1b[4m"
    static Blink = "\x1b[5m"
    static Reverse = "\x1b[7m"
    static Hidden = "\x1b[8m"

    static FgBlack = "\x1b[30m"
    static FgRed = "\x1b[31m"
    static FgGreen = "\x1b[32m"
    static FgYellow = "\x1b[33m"
    static FgBlue = "\x1b[34m"
    static FgMagenta = "\x1b[35m"
    static FgCyan = "\x1b[36m"
    static FgWhite = "\x1b[37m"
    static FgGray = "\x1b[90m"

    static BgBlack = "\x1b[40m"
    static BgRed = "\x1b[41m"
    static BgGreen = "\x1b[42m"
    static BgYellow = "\x1b[43m"
    static BgBlue = "\x1b[44m"
    static BgMagenta = "\x1b[45m"
    static BgCyan = "\x1b[46m"
    static BgWhite = "\x1b[47m"
    static BgGray = "\x1b[100m"
}

export interface IStringDictionary {
    [key: string]: string
}

export interface IPromptAltValues {
    prompt: string
    hints: string[]
}