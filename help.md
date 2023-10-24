## Facts
* This bot does not permanently store any prompts or generated images locally, all of that is sent to Discord and reside solely in the channels posted to.
* There is no restriction on NSFW generation, but make sure that ends up in a channel that allows it.
* The bot can also be used in DMs with the bot user, this is recommended for private or spammy use.
## Usage
You use the bot through the slash command `/gen`, please use it in appropriate channels or in a DM with the bot user.  
You can run the command empty to launch an editor, or supply inline options:
* `prompt`: Description of what you want in the generated image, if this is not provided the editor will pop up.
* `negative-prompt`: Description of what should NOT be in the image.
* `count`: The number of images to generate in this batch.
* `aspect-ratio`: The format of the resulting image output.
* `spoiler`: Will spoiler tag all the image attachments.
### Buttons
When the bot has finished generating it will update the message with the images.  
This message includes these buttons:
* ❌: Delete the post, only works if you created it.
* ♻️: Reuse the post with the same seed, images will be the same with the same prompt.
* 🎲: Reuse the post with a random seed, images will be different with the same prompt.
* 🎛️: Generate a batch of variations of one of the images, these use a sub-seed with the original seed.
* ℹ️: Will post the information used to generate the image to you.
* 🦚: Will regenerate an image with more steps, adding more detail.
* 🍄: Will use an up-scaler to output an image at a higher resolution.
