# Stabled for Discord

This is a Discord bot that generates AI images with a Stable Diffusion node.

## Features

1. Adds the slash command `/gen`, `/help` and `/spam`.
2. Adds buttons to responses which allows further generation, deletion, increasing steps and more.
3. Works in servers as well as direct messages.
4. Does not store any data regarding prompts or generated images, that is all stored in the messages posted on Discord.

## How to run

1. Clone the repo or download the source.
2. Run `npm install` to install dependencies.
3. Use `config.json` or copy it to `config.local.json` if you want to update the bot in the future. Then fill in the values in it.
    * Use your own Discord bot client ID and secret.
    * Have an available [Stable Diffusion node](https://github.com/AUTOMATIC1111/stable-diffusion-webui) with the SD web API enabled.
4. Build it with `tsc`.
5. Run it with `node index.js`.

## How to use

The bot comes with multiple commands:
1. `/help` will tell you how to use it.
2. `/spam` will turn on an easy to use message based mode. 
3. `/gen` allows more advanced generation with more options. 