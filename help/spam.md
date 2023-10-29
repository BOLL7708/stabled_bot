# `/spam`

## Command Usage

Use this command to access the spam mode. The sub-commands are:

* `on`: Turn on the spam mode in the current channel.
* `off`: Turn off the spam mode in the current channel.
* `thread`: Create a private thread for the spam mode, it takes an optional `title` option that names the thread.

When enabled in a channel this mode has the bot listen to each posted message and uses it as a prompt. The exception is if you reply to an existing message, those messages will be ignored, and it's how to interact in the channel without causing generations.

*Note*: This feature can also be used when turned off, by simply tagging the bot user anywhere in your message.

## Chat Usage

You can format your message for some advanced options:

### Variations

* Square brackets with comma separated values will create one generation per value, for example `A [red,green,blue] cat` will create three prompts with the same base but with each color separately: `A red cat`, `A green cat`, `A blue cat`.
  * You can use multiple groups of square brackets in one message, all possible variations will be generated, until you hit a set limit. `[1,2,3]x cute [cats,dogs]` will generate six (3*2) different prompts.
  * Square bracket groups are replaced first, so they can be used everywhere in the prompt and still work, to vary the format and/or negative prompt as well.

### Format

* You can set the format of the picture in curly brackets, `{4:3}`, you can use a period for decimals `{1.5x2}` and use anything else as the separator `{10-20}`. The size is normalized like in other modes.

### Negative Prompt

* If you include a semicolon `;` in the message, anything after this symbol will be used as the negative prompt, `city street;people,humans` will hopefully make a street void of people.