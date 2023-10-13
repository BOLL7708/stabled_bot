export default class Utils {
    static calculateWidthHeightForAspectRatio(aspectRatioStr: string) {
        const aspectRatioPair = aspectRatioStr.split(':')
        const aspectRatio = Number(aspectRatioPair[0]) / Number(aspectRatioPair[1])
        const width = Math.round(Math.sqrt(aspectRatio * (512 * 512)))
        const height = Math.round(width / aspectRatio)
        return {width, height}
    }

    static getSerial(seed: number|string, count: number|string): string {
        return `${Date.now()}${count}-${seed}`
    }
}