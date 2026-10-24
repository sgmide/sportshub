
"use strict";

const admin = require("firebase-admin");
const path = require("path");

const TIME_ZONE = "Asia/Kolkata";
const FETCH_DATES = [-1, 0, 1];

function fail(message) {
    throw new Error(message);
}

function toId(value) {
    if (value === null || value === undefined) return "";
    return String(value).trim();
}

function toText(value) {
    if (value === null || value === undefined) return "";
    return String(value).trim();
}

function getDate(offset) {
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

    return {
        iso: values.year + "-" + values.month + "-" + values.day,
        display: values.day + "-" + values.month + "-" + values.year
    };
}

function normalizeProvider(value) {
    const provider = toText(value).toLowerCase();

    if (["365", "365scores", "365-scores"].includes(provider)) {
        return "365scores";
    }

    if (["king", "totalsportslive"].includes(provider)) {
        return "king";
    }

    if (
        ["api_parser", "api-football", "apifootball", "football"]
            .includes(provider)
    ) {
        return "api-football";
    }

    return provider;
}

function getProvider(settings) {
    const parserKey = settings.selected_parser || "parse1";
    const parser = settings.parse && settings.parse[parserKey];

    if (!parser) {
        fail("Selected parser not found: " + parserKey);
    }

    const provider = normalizeProvider(parser.api_parser);

    if (!["365scores", "king", "api-football"].includes(provider)) {
        fail("Unsupported API provider: " + provider);
    }

    return {
        name: provider,
        parserKey: parserKey,
        parserSettings: parser
    };
}

function getSelectedSports(settings) {
    const value = settings.selected_sports;

    if (!Array.isArray(value)) {
        return [];
    }

    const result = [];

    value.forEach(function (item, index) {
        if (item === true && index > 0) {
            result.push(String(index));
        } else if (
            item &&
            typeof item === "object" &&
            item.id !== undefined &&
            item.selected !== false
        ) {
            result.push(toId(item.id));
        } else if (
            typeof item === "number" ||
            typeof item === "string"
        ) {
            const id = toId(item);
            if (id && id !== "0") result.push(id);
        }
    });

    return Array.from(new Set(result));
}

function loadProvider(providerName) {
    const fileNames = {
        "365scores": "365scores.js",
        "king": "king.js",
        "api-football": "api-football.js"
    };

    const fileName = fileNames[providerName];

    if (!fileName) {
        fail("No module configured for provider: " + providerName);
    }

    const modulePath = path.join(__dirname, "apis", fileName);
    return require(modulePath);
}

function getCompetitionId(match) {
    return toId(
        match.competitionId ||
        match.leagueId ||
        match.tournamentId ||
        match.competition_id
    );
}

function getCompetitionName(match) {
    return toText(
        match.competitionName ||
        match.league ||
        match.competition ||
        match.leagueName ||
        "Unknown Competition"
    );
}

function getSportId(match) {
    return toId(match.sportId || match.sport_id || "1");
}

function normalizeMatch(raw, providerName, oldMatch) {
    const match = Object.assign({}, raw || {});

    const gameId = toId(
        match.gameId ||
        match.apiFixtureId ||
        match.fixtureId ||
        match.id
    );

    if (!gameId) return null;

    const home = toText(
        match.home ||
        match.homeTeam ||
        match.homeName ||
        match.homeTeamName
    );

    const away = toText(
        match.away ||
        match.awayTeam ||
        match.awayName ||
        match.awayTeamName
    );

    const homeScore = match.homeScore !== undefined
        ? match.homeScore
        : (match.goals && match.goals.home);

    const awayScore = match.awayScore !== undefined
        ? match.awayScore
        : (match.goals && match.goals.away);

    let score = toText(match.score);

    if (!score && homeScore !== null && homeScore !== undefined &&
        awayScore !== null && awayScore !== undefined) {
        score = homeScore + " - " + awayScore;
    }

    const competitionId = getCompetitionId(match);
    const competitionName = getCompetitionName(match);

    const normalized = Object.assign({}, match, {
        gameId: gameId,
        apiFixtureId: toId(match.apiFixtureId || gameId),
        apiProvider: providerName,

        home: home,
        away: away,

        homeCompetitorId: toId(
            match.homeCompetitorId ||
            match.homeTeamId ||
            match.homeId
        ),
        awayCompetitorId: toId(
            match.awayCompetitorId ||
            match.awayTeamId ||
            match.awayId
        ),

        homeLogo: toText(match.homeLogo || match.homeTeamLogo),
        awayLogo: toText(match.awayLogo || match.awayTeamLogo),

        competitionId: competitionId,
        league: competitionName,
        sportId: getSportId(match),

        score: score,
        homeScore: homeScore === undefined ? null : homeScore,
        awayScore: awayScore === undefined ? null : awayScore,

        date: toText(match.date),
        time: toText(match.time),
        matchTimeMillis: Number(
            match.matchTimeMillis || match.timestamp || 0
        ),

        status: toText(match.status || match.shortStatus || "NS"),
        shortStatus: toText(match.shortStatus || match.status || "NS"),

        stadium: toText(match.stadium || match.venue),
        goalEvents: match.goalEvents || {}
    });

    /*
     * Same provider: preserve the admin's stream URL when the
     * API response doesn't provide a replacement.
     *
     * Provider changed: oldMatch is not passed, so the previous
     * provider's stream URL cannot leak into the new provider.
     */
    if (oldMatch) {
        const oldStreamUrl = toText(oldMatch.streamUrl);
        const newStreamUrl = toText(match.streamUrl);

        normalized.streamUrl = newStreamUrl || oldStreamUrl;
    } else {
        normalized.streamUrl = toText(match.streamUrl);
    }

    return normalized;
}

function normalizeCompetition(raw, providerName) {
    const id = toId(raw.id || raw.competitionId || raw.leagueId);
    if (!id) return null;

    return {
        id: id,
        name: toText(raw.name || raw.competitionName || raw.league || id),
        selected: raw.selected === true,
        sportId: toText(raw.sportId || raw.sport_id || "1"),
        apiProvider: providerName
    };
}

function buildCompetitionMap(matches, existingCompetitions, providerName) {
    const map = {};

    (existingCompetitions || []).forEach(function (item) {
        if (item && item.id !== undefined) {
            const competition = normalizeCompetition(item, providerName);
            if (competition) map[competition.id] = competition;
        }
    });

    matches.forEach(function (match) {
        const id = getCompetitionId(match);
        if (!id) return;

        if (!map[id]) {
            map[id] = {
                id: id,
                name: getCompetitionName(match),
                selected: false,
                sportId: getSportId(match),
                apiProvider: providerName
            };
        }
    });

    return map;
}

function normalizeCatalog(catalog, providerName) {
    const sports = {};
    const competitions = {};

    (catalog && Array.isArray(catalog.sports) ? catalog.sports : [])
        .forEach(function (sport) {
            const id = toId(sport.id || sport.sportId);
            if (!id) return;

            sports[id] = Object.assign({}, sport, {
                id: id,
                name: toText(sport.name || id),
                apiProvider: providerName
            });
        });

    (catalog && Array.isArray(catalog.competitions)
        ? catalog.competitions : [])
        .forEach(function (raw) {
            const competition = normalizeCompetition(raw, providerName);
            if (competition) competitions[competition.id] = competition;
        });

    return {
        sports: sports,
        competitions: competitions
    };
}

async function fetchMatches(provider, providerName, parserSettings, sports) {
    const allMatches = {};
    const errors = [];

    for (const offset of FETCH_DATES) {
        const date = getDate(offset);

        try {
            let result;

            if (providerName === "api-football") {
                result = await provider.fetchMatches({
                    date: date.iso,
                    settings: {},
                    parserSettings: parserSettings,
                    sportIds: sports,
                    timeZone: TIME_ZONE
                });
            } else if (providerName === "king") {
                result = await provider.fetchMatches({
                    date: date.iso,
                    startDate: date.display,
                    endDate: date.display,
                    parserSettings: parserSettings,
                    sportIds: sports,
                    timeZone: TIME_ZONE
                });
            } else {
                result = await provider.fetchMatches({
                    sportIds: sports,
                    startDate: date.display,
                    endDate: date.display,
                    parserSettings: parserSettings,
                    timeZone: TIME_ZONE
                });
            }

            if (!Array.isArray(result)) {
                fail(
                    providerName + " fetchMatches() must return an array."
                );
            }

            result.forEach(function (raw) {
                const match = normalizeMatch(raw, providerName, null);
                if (match) allMatches[match.gameId] = match;
            });

            console.log(
                providerName + " fetched " + result.length +
                " matches for " + date.iso
            );
        } catch (error) {
            errors.push(date.iso + ": " + error.message);
            console.error(
                providerName + " failed for " + date.iso + ":",
                error.message
            );
        }
    }

    if (Object.keys(allMatches).length === 0 && errors.length > 0) {
        fail("No matches fetched. " + errors.join(" | "));
    }

    return Object.values(allMatches);
}

async function main() {
    const serviceAccountText = process.env.FIREBASE_SERVICE_ACCOUNT;
    const databaseURL = process.env.FIREBASE_DATABASE_URL;

    if (!serviceAccountText || !databaseURL) {
        fail("Firebase secrets are missing.");
    }

    let serviceAccount;

    try {
        serviceAccount = JSON.parse(serviceAccountText);
    } catch (error) {
        fail("FIREBASE_SERVICE_ACCOUNT is not valid JSON.");
    }

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: databaseURL
    });

    const db = admin.database();
    const rootRef = db.ref("/");
    const snapshot = await rootRef.once("value");
    const root = snapshot.val() || {};

    const settings = root.settings || {};
    const selectionSettings = root.competition_selection || {};
    const oldMatches = root.matches || {};
    const oldCompetitions = root.competitions || {};
    const oldSports = root.sports || {};

    const selected = getProvider(settings);
    const providerName = selected.name;
    const parserSettings = selected.parserSettings;
    const provider = loadProvider(providerName);

    const previousProvider = normalizeProvider(
        settings.last_synced_api_provider || ""
    );

    const providerChanged =
        previousProvider !== "" && previousProvider !== providerName;

    const selectedSports = getSelectedSports(settings);

    console.log("Selected parser:", selected.parserKey);
    console.log("Selected provider:", providerName);
    console.log("Previous provider:", previousProvider || "not recorded");
    console.log("Provider changed:", providerChanged);
    console.log("Selected sports:", selectedSports);

    /*
     * When changing providers, intentionally start with empty match,
     * competition and selection data. Other Firebase nodes remain intact.
     */
    if (providerChanged) {
        await db.ref("matches").set({});
        await db.ref("competitions").set({});
        await db.ref("competition_selection").set({});
        console.log("Old provider data cleared.");
    }

    let catalog = {
        sports: {},
        competitions: {}
    };

    if (typeof provider.fetchCatalog === "function") {
        try {
            const rawCatalog = await provider.fetchCatalog({
                sportIds: selectedSports,
                settings: settings,
                parserSettings: parserSettings,
                timeZone: TIME_ZONE
            });

            catalog = normalizeCatalog(rawCatalog, providerName);
        } catch (error) {
            console.warn("Catalog fetch failed:", error.message);
        }
    }

    const fetchedMatches = await fetchMatches(
        provider,
        providerName,
        parserSettings,
        selectedSports
    );

    /*
     * Discover competitions from match data when the provider has
     * no catalog endpoint, or its catalog contains no competitions.
     */
    const competitionMap = buildCompetitionMap(
        fetchedMatches,
        Object.values(catalog.competitions),
        providerName
    );

    const competitionIds = Object.keys(competitionMap);

    if (competitionIds.length === 0) {
        fail("No competitions discovered. Existing data was not replaced.");
    }

    const newCompetitionSelection = {};
    const newCompetitions = {};

    competitionIds.forEach(function (id) {
        const competition = competitionMap[id];

        let isSelected = false;

        if (providerChanged) {
            isSelected = true;
        } else if (selectionSettings[id] === true) {
            isSelected = true;
        } else if (
            oldCompetitions[id] &&
            oldCompetitions[id].selected === true
        ) {
            isSelected = true;
        } else if (
            competition.selected === true
        ) {
            isSelected = true;
        }

        competition.selected = isSelected;
        newCompetitions[id] = competition;
        newCompetitionSelection[id] = isSelected;
    });

    const sportsToSave = Object.keys(catalog.sports).length > 0
        ? catalog.sports
        : oldSports;

    const filteredMatches = {};

    fetchedMatches.forEach(function (match) {
        const competitionId = match.competitionId;

        if (!competitionId) return;
        if (newCompetitionSelection[competitionId] !== true) return;

        if (
            selectedSports.length > 0 &&
            !selectedSports.includes(toId(match.sportId))
        ) {
            return;
        }

        const gameId = match.gameId;
        const previousMatch = providerChanged ? null : oldMatches[gameId];

        filteredMatches[gameId] = normalizeMatch(
            match,
            providerName,
            previousMatch || null
        );
    });

    /*
     * On the same provider, keep older records not returned by this
     * three-day fetch. On a provider change, the old match map is empty.
     */
    const finalMatches = providerChanged
        ? {}
        : Object.assign({}, oldMatches);

    Object.keys(filteredMatches).forEach(function (gameId) {
        finalMatches[gameId] = filteredMatches[gameId];
    });

    const now = Date.now();

    /*
     * Update only the nodes owned by this sync job.
     * Do not replace the whole Firebase root.
     */
    const updates = {
        sports: sportsToSave,
        competitions: newCompetitions,
        competition_selection: newCompetitionSelection,
        matches: finalMatches,
        "settings/last_synced_api_provider": providerName,
        "settings/last_sync_status": "success",
        "settings/last_sync_time": now,
        "settings/last_sync_error": null
    };

    await rootRef.update(updates);

    console.log("Provider:", providerName);
    console.log("Competitions:", Object.keys(newCompetitions).length);
    console.log("Matches fetched:", fetchedMatches.length);
    console.log("Selected matches:", Object.keys(filteredMatches).length);
    console.log("Total matches stored:", Object.keys(finalMatches).length);
    console.log("Sports Hub sync completed.");
}

main()
    .catch(async function (error) {
        console.error("Sports Hub sync failed:", error.message);

        try {
            if (admin.apps.length > 0) {
                await admin.database().ref("settings").update({
                    last_sync_status: "failed",
                    last_sync_error: error.message,
                    last_sync_time: Date.now()
                });
            }
        } catch (saveError) {
            console.error(
                "Could not save failure status:",
                saveError.message
            );
        }

        process.exitCode = 1;
    })
    .finally(async function () {
        if (admin.apps.length > 0) {
            await Promise.all(
                admin.apps.map(function (app) {
                    return app.delete();
                })
            );
        }
    });
