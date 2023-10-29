import axios, {AxiosInstance, AxiosResponse} from 'axios'
import {MessageReference, PostOptions} from './DiscordCom.js'
import Config from './Config.js'
import Utils, {Color, IStringDictionary} from './Utils.js'
import {ISeed} from './DiscordUtils.js'

export default class StabledAPI {
    private static _api: AxiosInstance
    private static _generatedImageCount: number = 0
    private static _queueIndex = 0
    private static _queue: Map<number, QueueItem> = new Map()
    private static _listeners: IStabledResultListener[] = []
    static currentQueueItem: QueueItem | undefined = undefined

    // region Init
    private static async ensureAPI() {
        const config = await Config.get()
        if (!this._api) {
            this._api = axios.create({
                baseURL: config.serverAddress + '/sdapi/v1',
                timeout: config.timeoutMins * 60 * 1000,
                headers: {'Content-Type': 'application/json'},
                method: 'post'
            })
        }
    }

    // endregion

    // region Queued Methods

    static enqueueGeneration(item: QueueItem) {
        this.registerQueueItem(item)
        Utils.log('Enqueued', `${item.imageOptions.count} image(s)`, `#${item.index} ` + item.reference.getConsoleLabel(), Color.FgMagenta)
    }

    static registerResultListener(listener: IStabledResultListener) {
        this._listeners.push(listener)
    }

    private static notifyResultListeners(item: QueueItem) {
        Utils.log('Finished', `${Object.keys(item.postOptions.images).length} image(s)`, `#${item.index} ` + item.reference.getConsoleLabel(), Color.FgGreen)
        for (const listener of this._listeners) {
            listener(item)
        }
    }

    static async startGenerationOfImages(item: QueueItem) {
        const config = await Config.get()
        this.unregisterQueueItem(item)
        this.currentQueueItem = item

        Utils.log('Starting', `${item.imageOptions.count} image(s)`, `#${item.index} ` + item.reference.getConsoleLabel(), Color.FgYellow)
        await this.ensureAPI()
        const [width, height] = item.imageOptions.size.split('x')

        const seed = Number(item.imageOptions.predefinedSeed?.seed)
        const subseed = Number(item.imageOptions.predefinedSeed?.variantSeed)
        const body = {
            prompt: item.imageOptions.prompt,
            negative_prompt: item.imageOptions.negativePrompt,
            n_iter: item.imageOptions.count,
            steps: item.imageOptions.details ? 80 : 20,
            width,
            height,
            seed: isNaN(seed) ? -1 : seed
        }

        if (!isNaN(subseed) && subseed > 0) {
            // To retain subseed usage when increasing details
            body['subseed'] = subseed
            body['subseed_strength'] = config.variationStrenth ?? 0.1
        }
        if (item.imageOptions.variation) {
            body['subseed'] = -1
            body['subseed_strength'] = config.variationStrenth ?? 0.1
        }
        if (item.imageOptions.hires) {
            body['enable_hr'] = true
            body['hr_scale'] = 2
            body['hr_upscaler'] = 'Latent'
            body['denoising_strength'] = 0.7
        }

        // Do the request
        let response: AxiosResponse<IStabledResponse>
        try {
            response = await this._api.post(`txt2img`, body)
        } catch (e) {
            console.error('Error queueing up image generation:', e.message)
        }

        // Get images from response and inject them into the item
        if (response?.data) {
            const data = response.data
            const info = JSON.parse(data.info) as IStabledResponseInfo
            const imageDic: IStringDictionary = {}
            for (const image of data.images) {
                const seed = info.all_seeds.shift() ?? ''
                const subseed = info.all_subseeds.shift() ?? ''
                const subseedStrength = info.subseed_strength
                const serial = Utils.getSerial(seed, subseedStrength > 0 ? subseed : '', ++this._generatedImageCount)
                imageDic[serial] = image
            }
            item.postOptions.images = imageDic
        }
        this.currentQueueItem = undefined
        this.notifyResultListeners(item)
    }

    // endregion
    static async upscaleImageData(
        item: QueueItem,
        upscaleFactor: number,
        fileName: string
    ) {
        // const body = {
        //     upscaling_resize: upscaleFactor,
        //     upscaler_1: 'Lanczos',
        //     upscaler_2: 'None',
        //     extras_upscaler_2_visibility: 0,
        //     upscale_first: false,
        //     image: data
        // }
        //
        // const queueIndex = this.registerQueueItem(item)
        // let response: IStringDictionary = {}
        // try {
        //     const upscaleResponse = await this._api.post(`extra-single-image`, body)
        //     if (upscaleResponse.data) {
        //         response = {[`${fileName}_${upscaleFactor}x`]: upscaleResponse.data.image}
        //     }
        // } catch (e) {
        //     console.error('Up-scaling failed', e.message)
        // }
        // this.unregisterQueueItem(queueIndex)
        // return response
    }

    // region Non-queued Methods
    static async getProgress(): Promise<IProgressResponse | undefined> {
        await this.ensureAPI()
        let progressResponse: AxiosResponse<IProgressResponse>
        try {
            progressResponse = await this._api.get('progress')
        } catch (e) {
            console.error(e)
        }
        return progressResponse?.data
    }

    static async getPNGInfo(base64ImageData: string): Promise<IPNGInfoResponse | undefined> {
        await this.ensureAPI()
        const body = {
            image: base64ImageData
        }
        try {
            const response: AxiosResponse<IPNGInfoResponse> = await this._api.post(`png-info`, body)
            return response.data
        } catch (e) {
            console.error(e)
        }
    }

    // endregion

    // region Queue Handling
    static getNextQueueIndex(): number {
        return ++this._queueIndex
    }

    static registerQueueItem(item: QueueItem) {
        this._queue.set(item.index, item)
    }

    static unregisterQueueItem(item: QueueItem) {
        this._queue.delete(item.index)
    }

    static getNextInQueue(): QueueItem | undefined {
        return this._queue.values().next().value
    }

    static getQueueSize(): number {
        return this._queue.size
    }

    // endregion
}

// region Data Classes
export class ImageGenerationOptions {
    constructor() {
    }

    prompt: string = ''
    negativePrompt: string = ''
    size: string = '512x512'
    count: number = 4
    predefinedSeed: ISeed | undefined = undefined
    variation: boolean = false
    hires: boolean = false
    details: boolean = false
    promptHints: string[] = []

    static newFrom(genOptions: ImageGenerationOptions) {
        const newOptions = new ImageGenerationOptions()
        for (const [field, value] of Object.entries(genOptions)) {
            newOptions[field] = value
        }
        return newOptions
    }
}

export class QueueItem {
    constructor(
        public index: number,
        public reference: MessageReference,
        public imageOptions: ImageGenerationOptions,
        public postOptions: PostOptions
    ) {
    }
}

// endregion

// region Interfaces
interface IStabledResponse {
    images: string[]
    parameters: {
        prompt: string
        negative_prompt: string
        styles: any
        seed: number
        subseed: number
        subseed_strength: number
        seed_resize_from_h: number
        seed_resize_from_w: number
        sampler_name: any,
        batch_size: number
        n_iter: number
        steps: number
        cfg_scale: number
        width: number
        height: number
        restore_faces: any
        tiling: any
        do_not_save_samples: boolean
        do_not_save_grid: boolean
        eta: any
        denoising_strength: number
        s_min_uncond: any
        s_churn: any
        s_tmax: any
        s_tmin: any
        s_noise: any
        override_settings: any
        override_settings_restore_afterwards: boolean
        refiner_checkpoint: any
        refiner_switch_at: any
        disable_extra_networks: boolean
        comments: any
        enable_hr: boolean
        firstphase_width: number
        firstphase_height: number
        hr_scale: number
        hr_upscaler: any
        hr_second_pass_steps: number
        hr_resize_x: number
        hr_resize_y: number
        hr_checkpoint_name: any
        hr_sampler_name: any
        hr_prompt: string
        hr_negative_prompt: string
        sampler_index: string
        script_name: any
        script_args: []
        send_images: boolean
        save_images: boolean
        alwayson_scripts: any
    },
    info: string
}

export interface IStabledResponseInfo {
    prompt: string
    all_prompts: string[]
    negative_prompt: string
    all_negative_prompts: string[]
    seed: number
    all_seeds: number[]
    subseed: number[]
    all_subseeds: number[]
    subseed_strength: number
    width: number
    height: number
    sampler_name: string
    cfg_scale: number
    steps: number
    batch_size: number
    restore_faces: boolean
    face_restoration_model: string
    sd_model_name: string
    sd_model_hash: string
    sd_vae_name: any
    sd_vae_hash: any
    seed_resize_from_w: number
    seed_resize_from_h: number
    denoising_strength: number
    extra_generation_params: object
    index_of_first_image: number
    infotexts: string[]
    styles: any[]
    job_timestamp: string
    clip_skip: number
    is_using_inpainting_conditioning: boolean
}

interface IProgressResponse {
    progress: number
    eta_relative: number
    state: {
        skipped: boolean
        interrupted: boolean
        job: string
        job_count: number
        job_timestamp: string
        job_no: number
        sampling_step: number
        sampling_steps: number
    },
    current_image: string,
    textinfo: any
}

export interface IPNGInfoResponse {
    info: string
    items: {
        parameters: string
    }
}

export interface IStabledResultListener {
    (item: QueueItem): void
}

// endregion