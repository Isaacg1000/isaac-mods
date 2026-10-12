# isaac-mods

Eight mods for Claude Code (terminal and the desktop app's Code tab). Requires Claude Code 2.1.287 or newer.

| Mod | What it does | Commands |
| --- | --- | --- |
| savvy-progress | Progress bar above the prompt; an Agents side panel with a pixel crab per subagent showing model, effort, task progress, context, tokens and estimated cost | `/savvy`, `/crab-style <keyword> <color> <hat>` |
| tool-skins | Themed icons and colors for tool calls (Tokyo Night, Nord, Dracula, Gruvbox, Solarized, Catppuccin, Rose Pine) | `/skin <theme>` |
| you-should-know | After a long reply, a Haiku side agent flags costs, risks and actions you might miss | `/ysk on`, `/ysk off`, `/ysk focus <text>` |
| file-tree | A panel showing which files Claude is reading or editing; turns green once committed | `/files` |
| cache-tax | Warns before a prompt reloads a cold prompt cache, with a token and cost estimate | `/keepwarm`, `/cachetax ttl <minutes>` |
| blast-radius | Stops `rm -r`, `Remove-Item -Recurse`, `git clean -f`, `git reset --hard` and similar, lists the files at stake, and waits for Proceed or Cancel | automatic |
| reflect | Spots corrections in your prompts and offers to save them as rules in CLAUDE.md | `/reflect <rule>` |
| terminal-browser | A text-mode browser pane; Claude can open pages there too | `/browse <url or path>` |

Cost figures are estimates at API list prices. you-should-know and reflect make small Haiku calls, which count toward your usage.

## Install

At a Claude Code prompt in a terminal:

```
/plugin install savvy-progress --marketplace Isaacg1000/isaac-mods
```

Answer `y` to add the marketplace, then pick the user scope. Repeat with each mod name you want.

Or from a shell, all at once:

```
claude plugin marketplace add Isaacg1000/isaac-mods
claude plugin install savvy-progress@isaac-mods --scope user
claude plugin install tool-skins@isaac-mods --scope user
claude plugin install you-should-know@isaac-mods --scope user
claude plugin install file-tree@isaac-mods --scope user
claude plugin install cache-tax@isaac-mods --scope user
claude plugin install blast-radius@isaac-mods --scope user
claude plugin install reflect@isaac-mods --scope user
claude plugin install terminal-browser@isaac-mods --scope user
```

## Developing

Each mod lives in `plugins/<name>/`: `hooks/register.tsx` is the hooks module, `types/index.d.ts` its state contract. Check and test one with:

```
claude plugin validate plugins/<name>
claude plugin test plugins/<name>
```

When this folder is added as a local marketplace (`claude plugin marketplace add <this folder>`), edits are picked up with `/reload-plugins`.
