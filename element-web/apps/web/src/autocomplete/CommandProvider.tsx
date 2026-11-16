/*
Copyright 2024 New Vector Ltd.
Copyright 2018 Michael Telatynski <7t3chguy@gmail.com>
Copyright 2017 Vector Creations Ltd
Copyright 2017 New Vector Ltd
Copyright 2016 Aviral Dasgupta

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React from "react";
import { type Room } from "matrix-js-sdk/src/matrix";

import { _t } from "../languageHandler";
import AutocompleteProvider from "./AutocompleteProvider";
import QueryMatcher from "./QueryMatcher";
import { TextualCompletion } from "./Components";
import { type ICompletion, type ISelectionRange } from "./Autocompleter";
import { type Command, Commands, CommandMap } from "../slash-commands/SlashCommands";
import { type TimelineRenderingType } from "../contexts/RoomContext";
import { MatrixClientPeg } from "../MatrixClientPeg";
import { cachedBotInfo, isBotRoom, loadBotInfo } from "../aranchat/bot";

const COMMAND_RE = /(^\/\w*)(?: .*)?/g;

export default class CommandProvider extends AutocompleteProvider {
    public matcher: QueryMatcher<Command>;
    private room: Room;
    public constructor(room: Room, renderingType?: TimelineRenderingType) {
        super({ commandRegex: COMMAND_RE, renderingType });
        this.matcher = new QueryMatcher(Commands, {
            keys: ["command", "args", "description"],
            funcs: [({ aliases }) => aliases.join(" ")], // aliases
            context: renderingType,
        });
        this.room = room;
        if (isBotRoom(room)) void loadBotInfo().catch(() => {});
    }

    /** AranChat: คำสั่งของบอทแจ้งเตือน (ห้องบอทเท่านั้น) — แสดงก่อนคำสั่งของแอป และแทนคำสั่งชื่อเดียวกัน */
    private botCompletions(command: RegExpMatchArray, range: ISelectionRange): { names: Set<string>; list: ICompletion[] } {
        const info = isBotRoom(this.room) ? cachedBotInfo() : null;
        if (!info) return { names: new Set(), list: [] };
        const typed = command[1].slice(1).toLowerCase();
        const hasArgs = command[0] !== command[1];
        const list = info.commands
            .filter((c) => (hasArgs ? c.command === typed : c.command.startsWith(typed)))
            .map((c) => ({
                completion: hasArgs ? command[0] : `/${c.command} `,
                type: "command" as const,
                component: (
                    <TextualCompletion
                        title={`/${c.command}`}
                        subtitle={c.usage?.replace(/^\/\S+\s*/, "") ?? ""}
                        description={c.system ? `${c.description} · ${c.system}` : c.description}
                    />
                ),
                range,
            }));
        return { names: new Set(info.commands.map((c) => c.command)), list };
    }

    public async getCompletions(
        query: string,
        selection: ISelectionRange,
        force?: boolean,
        limit = -1,
    ): Promise<ICompletion[]> {
        const { command, range } = this.getCurrentCommand(query, selection);
        if (!command) return [];

        const cli = MatrixClientPeg.get();
        const bot = this.botCompletions(command, range!);

        let matches: Command[] = [];
        // check if the full match differs from the first word (i.e. returns false if the command has args)
        if (command[0] !== command[1]) {
            // The input looks like a command with arguments, perform exact match
            const name = command[1].slice(1); // strip leading `/`
            if (CommandMap.has(name) && CommandMap.get(name)!.isEnabled(cli, this.room.roomId)) {
                // some commands, namely `me` don't suit having the usage shown whilst typing their arguments
                if (CommandMap.get(name)!.hideCompletionAfterSpace) return [];
                matches = [CommandMap.get(name)!];
            }
        } else {
            if (query === "/") {
                // If they have just entered `/` show everything
                // We exclude the limit on purpose to have a comprehensive list
                matches = Commands;
            } else {
                // otherwise fuzzy match against all of the fields
                matches = this.matcher.match(command[1], limit);
            }
        }

        const appCompletions = matches
            .filter((cmd) => {
                const display = !cmd.renderingTypes || cmd.renderingTypes.includes(this.renderingType);
                return cmd.isEnabled(cli, this.room.roomId) && display && !bot.names.has(cmd.command);
            })
            .map((result) => {
                let completion = result.getCommand() + " ";
                const usedAlias = result.aliases.find((alias) => `/${alias}` === command[1]);
                // If the command (or an alias) is the same as the one they entered, we don't want to discard their arguments
                if (usedAlias || result.getCommand() === command[1]) {
                    completion = command[0];
                }

                return {
                    completion,
                    type: "command" as const,
                    component: (
                        <TextualCompletion
                            title={`/${usedAlias || result.command}`}
                            subtitle={result.args}
                            description={_t(result.description)}
                        />
                    ),
                    range: range!,
                };
            });
        return [...bot.list, ...appCompletions];
    }

    public getName(): string {
        return "*️⃣ " + _t("composer|autocomplete|command_description");
    }

    public renderCompletions(completions: React.ReactNode[]): React.ReactNode {
        return (
            <div
                className="mx_Autocomplete_Completion_container_pill"
                aria-label={_t("composer|autocomplete|command_a11y")}
            >
                {completions}
            </div>
        );
    }
}
