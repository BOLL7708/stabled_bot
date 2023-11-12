import { createCanvas } from 'canvas'
import { drawText } from 'canvas-txt'

export default class ImageUtils {
    static getImageWithText(text: string, fontSize: number, font: string, bold: boolean, italic: boolean, imageSize: string): string {
        const [width, height] = imageSize.split('x').map(Number)
        if(isNaN(width) || isNaN(height)) throw(new Error('Invalid image size'))
        if(!text.length) throw(new Error('Invalid text'))

        const canvas = createCanvas(width, height)
        const ctx: CanvasRenderingContext2D = canvas.getContext('2d') as unknown as CanvasRenderingContext2D
        ctx.fillStyle = '#000000'
        ctx.fillRect(0, 0, width, height)
        ctx.fillStyle = '#ffffff'
        drawText(ctx, text, {
            x: 0,
            y: 0,
            width,
            height,
            fontSize: 512*(fontSize/100),
            font,
            fontWeight: bold ? 'bold' : 'normal',
            fontStyle: italic ? 'italic' : 'normal'
        })

        // Convert the canvas to a buffer in PNG format
        return canvas.toDataURL().split(',')[1]
    }
}