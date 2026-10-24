"use strict";

const admin = require("firebase-admin");
const path = require("path");

const TIME_ZONE = "Asia/Kolkata";
const DEFAULT_PROVIDER = "365scores";
const FETCH_DATES = [-1, 0, 1];

function log(message) {
    console.log(message);
}

function getDateString(offset) {
    const date = new Date();

    date.setUTCDate(date.getUTCDate() + offset);

    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).formatToParts(date);

    const values = {};

    parts.forEach(function (part) {
        values[part.type] = part.value;
    });

    return values.year + "-" + values.month + "-" + values.day;
}

function normalizeProviderName(value) {
    const name = String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[_\s]/g, "-");

    if (
        name === "365" ||
        name === "365score" ||
        name === "365scores"
    ) {
        return "365scores";
    }

    if (name === "king") {
        return "king";
    }

    if (
        name === "api-parser" ||
        name === "api-football" ||
        name === "apifootball"
    ) {
        return "api-football";
    }

    return name || DEFAULT_PROVIDER;
}

function getProviderName(settings) {
    settings = settings || {};

    const selectedParser = settings.selected_parser || "parse1";
    const parseSettings = settings.parse || {};
    const selectedConfig = parseSettings[selectedParser] || {};

    const providerValue =
        selectedConfig.api_parser ||
        selectedConfig.apiParser ||
        settings.api_parser ||
        DEFAULT_PROVIDER;

    return normalizeProviderName(providerValue);
}

function getSelectedSports(settings) {
    settings = settings || {};

    const selected = settings.selected_sports;
    const result = [];

    if (Array.isArray(selected)) {
        selected.forEach(function (item) {
            if (item !== null && item !== undefined && item !== "") {
                result.push(String(item));
            }
        });
    } else if (selected && typeof selected === "object") {
        Object.keys(selected).forEach(function (id) {
            if (selected[id] === true) {
                result.push(String(id));
            }
        });
    }

    return Array.from(new Set(result));
}

function normalizeCompetitionId(match) {
    if (!match) {
        return "0";
    }

    const possibleIds = [
        match.competitionId,
        match.leagueId,
        match.competition_id,
        match.league_id
    ];

    for (let i = 0; i < possibleIds.length; i++) {
        const value = possibleIds[i];

        if (
            value !== undefined &&
            value !== null &&
            String(value).trim() !== "" &&
            String(value) !== "0"
        ) {
            return String(value);
        }
    }

    return "0";
}

function normalizeMatchId(match) {
    if (!match) {
        return "";
    }

    const value =
        match.gameId ||
        match.apiFixtureId ||
        match.fixtureId ||
        match.id;

    return value === undefined || value === null
        ? ""
        : String(value);
}

function getCompetitionName(match) {
    return String(
        match.competitionName ||
        match.leagueName ||
        match.league ||
        match.competition ||
        "Unknown Competition"
    );
}

function getMatchDate(match) {
    return String(
        match.date ||
        match.matchDate ||
        match.startDate ||
        ""
    );
}

function loadProvider(providerName) {
    const providerPath = path.join(
        __dirname,
        "apis",
        providerName + ".js"
    );

    const provider = require(providerPath);

    if (!provider || typeof provider.fetchMatches !== "function") {
        throw new Error(
            "Provider " + providerName +
            " must export fetchMatches(options)."
        );
    }

    return provider;
}

function preserveOldFields(newMatch, oldMatch) {
    if (!oldMatch) {
        return newMatch;
    }

    const fieldsToPreserve = [
        "homeLogo",
        "awayLogo",
        "streamUrl",
        "stadium",
        "goalEvents"
    ];

    fieldsToPreserve.forEach(function (field) {
        const newValue = newMatch[field];
        const oldValue = oldMatch[field];

        const empty =
            newValue === undefined ||
            newValue === null ||
            newValue === "";

        if (
            empty &&
            oldValue !== undefined &&
            oldValue !== null
        ) {
            newMatch[field] = oldValue;
        }
    });

    return newMatch;
}

function getExistingSelection(root) {
    root = root || {};

    const oldSelection = root.competition_selection || {};
    const oldCompetitions = root.competitions || {};
    const selection = {};

    Object.keys(oldSelection).forEach(function (id) {
        selection[String(id)] = oldSelection[id] === true;
    });

    Object.keys(oldCompetitions).forEach(function (id) {
        if (selection[String(id)] === undefined) {
            selection[String(id)] =
                oldCompetitions[id] &&
                oldCompetitions[id].selected === true;
        }
    });

    return selection;
}

function buildCompetitionCatalog(matches, oldRoot, providerChanged) {
    const competitions = {};
    const selection = providerChanged
        ? {}
        : getExistingSelection(oldRoot);

    matches.forEach(function (match) {
        const competitionId = normalizeCompetitionId(match);

        if (competitionId === "0") {
            return;
        }

        const competitionName = getCompetitionName(match);

        if (!competitions[competitionId]) {
            const oldCompetition =
                !providerChanged &&
                oldRoot &&
                oldRoot.competitions &&
                oldRoot.competitions[competitionId]
                    ? oldRoot.competitions[competitionId]
                    : {};

            if (selection[competitionId] === undefined) {
                selection[competitionId] =
                    oldCompetition.selected === true;
            }

            competitions[competitionId] = Object.assign(
                {},
                oldCompetition,
                {
                    id: competitionId,
                    name: competitionName,
                    selected: selection[competitionId] === true
                }
            );

            if (match.sportId !== undefined) {
                competitions[competitionId].sportId =
                    String(match.sportId);
            }

            if (match.sportName) {
                competitions[competitionId].sportName =
                    String(match.sportName);
            }
        }

        competitions[competitionId].selected =
            selection[competitionId] === true;
    });

    return {
        competitions: competitions,
        selection: selection
    };
}

function buildSelectedMatches(matches, selection, oldRoot, providerChanged) {
    const result = {};
    const oldMatches =
        !providerChanged && oldRoot && oldRoot.matches
            ? oldRoot.matches
            : {};

    matches.forEach(function (match) {
        const matchId = normalizeMatchId(match);
        const competitionId = normalizeCompetitionId(match);

        if (!matchId || competitionId === "0") {
            return;
        }

        if (selection[competitionId] !== true) {
            return;
        }

        const savedMatch = Object.assign({}, match);

        savedMatch.gameId = matchId;
        savedMatch.competitionId = competitionId;

        if (!savedMatch.competitionName) {
            savedMatch.competitionName =
                getCompetitionName(match);
        }

        result[matchId] = preserveOldFields(
            savedMatch,
            oldMatches[matchId]
        );
    });

    return result;
}

async function fetchAllMatches(provider, sportIds) {
    const allMatches = [];
    const seenIds = new Set();

    for (let i = 0; i < FETCH_DATES.length; i++) {
        const offset = FETCH_DATES[i];
        const date = getDateString(offset);

        log("");
        log("Fetching matches for date: " + date);

        const fetched = await provider.fetchMatches({
            date: date,
            sportIds: sportIds,
            timezone: TIME_ZONE,
            timeZone: TIME_ZONE
        });

        if (!Array.isArray(fetched)) {
            throw new Error(
                "Provider returned invalid matches for " + date
            );
        }

        log("Fetched " + fetched.length + " matches for " + date);

        fetched.forEach(function (match) {
            const id = normalizeMatchId(match);

            if (!id) {
                return;
            }

            if (!seenIds.has(id)) {
                seenIds.add(id);
                allMatches.push(match);
            }
        });
    }

    return allMatches;
}

async function main() {
    if (!admin.apps.length) {
        const serviceAccountText =
            process.env.FIREBASE_SERVICE_ACCOUNT;

        if (!serviceAccountText) {
            throw new Error(
                "Missing FIREBASE_SERVICE_ACCOUNT GitHub secret."
            );
        }

        const serviceAccount = JSON.parse(serviceAccountText);

        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            databaseURL: process.env.FIREBASE_DATABASE_URL
        });
    }

    const db = admin.database();
    const rootRef = db.ref("/");
    const snapshot = await rootRef.once("value");
    const root = snapshot.val() || {};

    const settings = root.settings || {};
    const selectedParser = settings.selected_parser || "parse1";
    const providerName = getProviderName(settings);
    const previousProvider = normalizeProviderName(
        settings.last_synced_api_provider || ""
    );

    const providerChanged =
        !!settings.last_synced_api_provider &&
        previousProvider !== providerName;

    const sportIds = getSelectedSports(settings);

    log("Selected parser: " + selectedParser);
    log("Current provider: " + providerName);
    log("Previous provider: " + previousProvider);
    log("Provider changed: " + providerChanged);
    log("Selected sports: " + sportIds.join(", "));

    if (sportIds.length === 0) {
        throw new Error(
            "No sports selected. Select at least one sport first."
        );
    }

    const provider = loadProvider(providerName);

    const matches = await fetchAllMatches(provider, sportIds);

    log("");
    log("Total unique fetched matches: " + matches.length);

    if (matches.length === 0) {
        throw new Error(
            "API returned zero matches. Existing Firebase data was not changed."
        );
    }

    let matchesWithCompetitionId = 0;
    let matchesWithoutCompetitionId = 0;

    matches.forEach(function (match) {
        if (normalizeCompetitionId(match) === "0") {
            matchesWithoutCompetitionId++;
        } else {
            matchesWithCompetitionId++;
        }
    });

    log("Matches with competition ID: " + matchesWithCompetitionId);
    log("Matches without competition ID: " + matchesWithoutCompetitionId);

    const catalog = buildCompetitionCatalog(
        matches,
        root,
        providerChanged
    );

    const competitions = catalog.competitions;
    const selection = catalog.selection;

    const selectedCompetitionIds = Object.keys(selection).filter(
        function (id) {
            return selection[id] === true;
        }
    );

    log("Competitions found: " + Object.keys(competitions).length);
    log(
        "Selected competition IDs: " +
        selectedCompetitionIds.join(", ")
    );

    log(
        "API competition IDs: " +
        Object.keys(competitions).slice(0, 50).join(", ")
    );

    const selectedMatches = buildSelectedMatches(
        matches,
        selection,
        root,
        providerChanged
    );

    log("Matches for selected competitions: " +
        Object.keys(selectedMatches).length);

    const now = Date.now();

    const newSettings = Object.assign({}, settings, {
        last_synced_api_provider: providerName,
        lastSuccessfulSync: now,
        last_sync_time: now,
        last_sync_status: "success",
        selected_parser: selectedParser
    });

    /*
     * Provider changed:
     * Save the new competition catalog with all competitions
     * unselected, and clear matches from the old provider.
     * The user can then select competitions and sync again.
     */
    if (providerChanged) {
        const emptySelection = {};

        Object.keys(competitions).forEach(function (id) {
            competitions[id].selected = false;
            emptySelection[id] = false;
        });

        await rootRef.update({
            competitions: competitions,
            competition_selection: emptySelection,
            matches: null,
            settings: newSettings
        });

        log(
            "Provider changed. New competition catalog saved; " +
            "old matches cleared. Select competitions and sync again."
        );

        return;
    }

    /*
     * Important fix:
     * If no competitions are selected, still save the competition
     * catalog and selection map. Do not delete or replace matches.
     */
    if (Object.keys(selectedMatches).length === 0) {
        newSettings.last_sync_status = "catalog_updated";

        await rootRef.update({
            competitions: competitions,
            competition_selection: selection,
            settings: newSettings
        });

        log(
            "No selected-competition matches found. " +
            "Competition catalog saved successfully. " +
            "Existing matches were preserved."
        );

        log(
            "Open Competitions in the admin app, select competitions, " +
            "save, and run sync again."
        );

        return;
    }

    /*
     * Normal sync:
     * Save matches only for selected competitions.
     * Replace the matches node so unselected/old matches disappear.
     */
    newSettings.last_sync_status = "success";

    await rootRef.update({
        competitions: competitions,
        competition_selection: selection,
        matches: selectedMatches,
        settings: newSettings
    });

    log("SYNC SUCCESS");
    log("Competition count: " + Object.keys(competitions).length);
    log("Saved matches: " + Object.keys(selectedMatches).length);
}

main().catch(async function (error) {
    console.error("SYNC FAILED:", error);

    try {
        if (admin.apps.length) {
            const db = admin.database();
            await db.ref("settings").update({
                last_sync_status: "failed",
                last_sync_error: String(
                    error && error.message
                        ? error.message
                        : error
                )
            });
        }
    } catch (settingsError) {
        console.error(
            "Could not update sync error status:",
            settingsError
        );
    }

    process.exitCode = 1;
});
