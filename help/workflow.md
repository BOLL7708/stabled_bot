# Advanced Workflow Example

This example will show a working method to find things that you like.  
The flow is as follows: `spam` -> 🎲 -> 🎛️ -> 🦚

1. We will start in a channel that has `/spam on`, which means every message generates an image.
2. Here we will used advanced features of the spam mode with this chat message: `[exploding, metal, jelly] head of a person [in the desert, under water, in heaven]{3:2};nudity,nude,naked`
    1. This will prompt you to launch a thread where 36 images will be generated with all permutations possible between the `[]` groups.
    2. The `{3:2}` specification will affect the aspect ratio of the image output.
    3. Anything behind the `;` is the negative prompt.
3. When the thread has finished generating, we go through the images and find the ones we like.
    1. If we find a prompt combination we like the style of, we click the 🎲 button, this lets us edit the generation settings, and we change the `count` value to 10 before submitting.
    2. This will trigger a new generation of 10 images using the same prompt but with different seeds.
4. When the 10x batch generation is done we check if there is any we like, if so we click the 🎛️ button, then in the interface that appear we pick the image(s) we liked.
    1. This will generate four variations from the original, applying a secondary variation seed.
5. When the variations are done, we check for our favorite, then we click the 🦚 button to generate a version with more details.
    1. If none were better than the original, we do a detail generation on the original instead.
6. The detail generation is the final output, that is as good as it gets with this bot.