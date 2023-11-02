# `/param`

A command to set a parameter that will be substituted when used in a prompt. The parameter will be replaced before any other processing of the prompt, so you can use other features inside of parameters.

You can list all your parameters with `/list params`.

## `/param set`

Set a parameter to a value. There are two mandatory options:

* `name`: The name that you will then reference in a prompt, as such: `--name`
* `value`: The value that `--name` will be replaced with.

## `/param unset`

* `name`: The name of the parameter you want to remove.