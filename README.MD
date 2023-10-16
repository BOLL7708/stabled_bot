# Stabled for Discord
This was made to connect to a single node of Stable Diffusion, using SDAPI, specifically [Stable Diffusion WebUI](https://github.com/AUTOMATIC1111/stable-diffusion-webui). 

## Features
1. Adds the slash command `/gen`
2. Adds buttons to responses which allows further generation, deletion, up-scaling and more.
3. Works in servers as well as DMs.
4. Does not permanently store any data locally, everything is stored in the messages on Discord.

## How to run
1. Clone the repo
2. Run `npm install`
3. Use `config.json` or copy it to `config.local.json` if you want to update the bot in the future. Then fill in the values in it.
4. Build it with `tsc`
5. Run `node index.js`

## How to use

### Command
There is a slash command `/gen`, please use it in #ꓮⵊ-ꓢpam🤖, #ꓐots🤖 or in a DM with the bot user. It has various options:
* `prompt`: Mandatory description of what you want in the generated image.
* `negative-prompt`: Optional description of what should NOT be in the image.
* `count`: The number of images to generate in this batch.
* `aspect-ratio`: The format of the resulting image output.
* `spoiler`: Will spoiler tag all the image attachments.

### Buttons
When the bot has finished generating it will update the thinking message with the images, this includes these buttons:
* ❌: Delete the post (only if you made when in public channels, by anyone in a DM)
* 🔀: Reuse the post with a random seed, images will be different with the same prompt.
* 🔁: Reuse the post with the same seed, images will be the same with the same prompt.
* 🎛️: Generate a batch of variations of one of the images, these use a sub-seed with the original seed.
* 🍄: Will use an up-scaler to output an image at four times the resolution.