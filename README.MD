# Stabled for Discord
This was made to connect to a single node of Stable Diffusion, using SDAPI, specifically [Stable Diffusion WebUI](https://github.com/AUTOMATIC1111/stable-diffusion-webui). 

## Features
1. Adds the slash command `/gen`
2. Adds buttons to responses which allows further generation, deletion, up-scaling and more.
3. Works in servers as well as DMs.

## How to use
1. Clone the repo
2. Run `npm install`
3. Use `config.json` or copy it to `config.local.json` if you want to update the bot in the future. Then fill in the values in it.
4. Run `node index.js`