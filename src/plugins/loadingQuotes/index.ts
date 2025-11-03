/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2022 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { Devs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin from "@utils/types";
import presetQuotesText from "file://quotes.txt";

const presetQuotes = presetQuotesText
    .split("\n")
    .map((quote) => /^\s*[^#\s]/.test(quote) && quote.trim())
    .filter(Boolean) as string[];
const noQuotesQuote =
    "Did you really disable all loading quotes? What a buffoon you are...";

export default definePlugin({
    name: "LoadingQuotes",
    description: "Replace Discord's loading quotes with default plugin quotes",
    authors: [Devs.Vermin, Devs.Kravle, Devs.Blacksmith],
    required: true,

    patches: [
        {
            find: "#{intl::LOADING_DID_YOU_KNOW}",
            replacement: [
                {
                    match: /"_loadingText".+?(?=(\i)\[.{0,10}\.random)/,
                    replace: "$&$self.mutateQuotes($1),",
                },
                {
                    match: /"_eventLoadingText".+?(?=(\i)\[.{0,10}\.random)/,
                    replace: "$&$self.mutateQuotes($1),",
                },
            ],
        },
    ],

    mutateQuotes(quotes: string[]) {
        try {
            quotes.length = 0; // clear any existing quotes
            quotes.push(...presetQuotes);
            if (!quotes.length) quotes.push(noQuotesQuote);
        } catch (e) {
            new Logger("LoadingQuotes").error("Failed to mutate quotes", e);
        }
    },
});
