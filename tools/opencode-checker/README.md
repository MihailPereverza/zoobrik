# OpenCode checker for Zoobrik

Answer checking through the user's own OpenCode (`opencode serve`), so OpenCode's free models are used the way OpenCode allows.
The `zoobrik-check` agent has every tool disabled: a learner's answer is only text to grade, never instructions to run.

    cd tools/opencode-checker && opencode serve --port 4196 --pure --cors https://mihailpereverza.github.io

The server has no password: keep it on localhost or a private Tailscale network, never on the open internet.
