
"use strict";

const admin = require("firebase-admin");

const DEFAULT_API_URL = "https://webws.365scores.com/web/games/";
const IMAGE_URL = "https://imagecache.365scores.com/image/upload/f_auto,w_120,h_120,c_limit,q_auto:eco/v2/competitors/";
const TIME_ZONE = "Asia/Kolkata";
const REQUEST_TIMEOUT = 30000;
const REQUEST_DELAY = 500;

const HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36",
    "Accept": "application/json",
    "Referer": "https://www.365scores.com/",
    "Origin": "https://www.365scores.com"
};

// ==================================================
// FIREBASE
// ==================================================

function initializeFirebase() {
    if (admin.apps.length > 0) {
        return admin.database();
    }

    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
    const databaseURL = process.env.FIREBASE_DATABASE_URL;

    if (!serviceAccountJson || !databaseURL) {
        throw new Error(
            "Missing FIREBASE_SERVICE_ACCOUNT or FIREBASE_DATABASE_URL secret"
        );
    }

    admin.initializeApp({
        credential: admin.credential.cert(JSON.parse(serviceAccountJson)),
        databaseURL: databaseURL
    });

    return admin.database();
}

// ==================================================
// HELPERS
// ==================================================

function delay(ms) {
    return new Promise(function (resolve) {
        setTimeout(resolve, ms);
    });
}

function toPositiveInteger(value) {
    if (value === null || value === undefined || value === "") {
        return null;
    }

    const number = Number(value);

    return Number.isSafeInteger(number) && number > 0
        ? number
        : null;
}

function getDateParts(date) {
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: TIME_ZONE,
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
    }).formatToParts(date);

    const result = {};

    for (const part of parts) {
        if (part.type !== "literal") {
            result[part.type] = part.value;
        }
    }

    return result;
}

function formatApiDate(date) {
    const p = getDateParts(date);
    return p.day + "/" + p.month + "/" + p.year;
}

function formatMatchDate(value) {
    const date = new Date(value);

    if (isNaN(date.getTime())) {
        return "";
    }

    const p = getDateParts(date);

    return p.day + "-" + p.month + "-" + p.year;
}

function formatMatchTime(value) {
    const date = new Date(value);

    if (isNaN(date.getTime())) {
        return "";
    }

    return new Intl.DateTimeFormat("en-US", {
        timeZone: TIME_ZONE,
        hour: "2-digit",
        minute: "2-digit",
        hour12: true
    }).format(date);
}

function getDateOffset(days) {
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).formatToParts(new Date());

    const values = {};

    for (const part of parts) {
        if (part.type !== "literal") {
            values[part.type] = part.value;
        }
    }

    return new Date(Date.UTC(
        Number(values.year),
        Number(values.month) - 1,
        Number(values.day) + days,
        12, 0, 0
    ));
}

function getCompetitionId(competition) {
    if (!competition) {
        return null;
    }

    if (typeof competition !== "object") {
        return toPositiveInteger(competition);
    }

    return toPositiveInteger(
        competition.id ||
        competition.competitionId
    );
}

function getGameCompetitionId(game) {
    if (!game) {
        return null;
    }

    const directId = toPositiveInteger(game.competitionId);

    if (directId !== null) {
        return directId;
    }

    const nestedId = getCompetitionId(game.competition);

    if (nestedId !== null) {
        return nestedId;
    }

    return toPositiveInteger(game.competitionID);
}

function getSportId(item) {
    if (!item) {
        return null;
    }

    const directId = toPositiveInteger(item.sportId);

    if (directId !== null) {
        return directId;
    }

    if (item.sport && typeof item.sport === "object") {
        return toPositiveInteger(item.sport.id);
    }

    return null;
}

function getCompetitionName(competition) {
    return String(
        competition && (
            competition.name ||
            competition.competitionName ||
            competition.competitionDisplayName
        ) || "Unknown Competition"
    );
}

function isSelected(value) {
    if (value === true || value === 1 || value === "true") {
        return true;
    }

    if (value && typeof value === "object") {
        if (value.selected !== undefined) {
            return isSelected(value.selected);
        }

        if (value.isSelected !== undefined) {
            return isSelected(value.isSelected);
        }
    }

    return false;
}

function getGameStartTime(game) {
    return game.startTime ||
        game.startDate ||
        game.startTimeUtc ||
        "";
}

function getTeam(game, side) {
    const keys = side === "home"
        ? ["homeCompetitor", "homeTeam", "home"]
        : ["awayCompetitor", "awayTeam", "away"];

    for (const key of keys) {
        const value = game[key];

        if (value && typeof value === "object") {
            return value;
        }
    }

    return {};
}

function getTeamName(team) {
    if (typeof team === "string") {
        return team;
    }

    return team.name ||
        team.shortName ||
        team.displayName ||
        "";
}

function getTeamScore(team) {
    if (team.score === undefined || team.score === null) {
        return "";
    }

    return String(team.score);
}

// ==================================================
// FETCH JSON
// ==================================================

async function fetchJson(url) {
    const controller = new AbortController();

    const timer = setTimeout(function () {
        controller.abort();
    }, REQUEST_TIMEOUT);

    try {
        const response = await fetch(url, {
            method: "GET",
            headers: HEADERS,
            signal: controller.signal
        });

        if (!response.ok) {
            throw new Error(
                "HTTP " + response.status + " - " + url
            );
        }

        return await response.json();

    } finally {
        clearTimeout(timer);
    }
}

function buildBaseUrl(apiUrl) {
    const url = new URL(apiUrl);

    url.searchParams.set("appTypeId", "5");
    url.searchParams.set("langId", "1");
    url.searchParams.set("timezoneName", TIME_ZONE);
    url.searchParams.set("userCountryId", "113");
    url.searchParams.set("showOdds", "true");
    url.searchParams.set("onlyMajorGames", "false");
    url.searchParams.set("withTop", "true");

    return url;
}

// ==================================================
// FETCH SPORTS AND COMPETITIONS
// ==================================================

async function fetchSportsAndCompetitions(apiUrl) {
    const url = buildBaseUrl(apiUrl);
    const data = await fetchJson(url.toString());

    if (!data || !Array.isArray(data.sports)) {
        throw new Error(
            "API response does not contain sports array"
        );
    }

    if (!Array.isArray(data.competitions)) {
        throw new Error(
            "API response does not contain competitions array"
        );
    }

    console.log("API sports:", data.sports.length);
    console.log("API competitions:", data.competitions.length);

    return {
        sports: data.sports,
        competitions: data.competitions
    };
}

// ==================================================
// NORMALIZE SELECTED SPORTS
// ==================================================

function normalizeSportIds(settings) {
    const result = new Set();
    const selectedSports = settings.selected_sports;

    if (Array.isArray(selectedSports)) {
        for (let i = 0; i < selectedSports.length; i++) {
            const item = selectedSports[i];

            if (typeof item === "number" || typeof item === "string") {
                const id = toPositiveInteger(item);

                if (id !== null) {
                    result.add(id);
                }

            } else if (item && typeof item === "object") {
                if (item.selected === false) {
                    continue;
                }

                const id = toPositiveInteger(item.id);

                if (id !== null) {
                    result.add(id);
                }
            }
        }

        // Legacy boolean array format.
        if (selectedSports.some(function (item, index) {
            return index > 0 && item === true;
        })) {
            for (let i = 1; i < selectedSports.length; i++) {
                if (selectedSports[i] === true) {
                    result.add(i);
                }
            }
        }

    } else if (
        selectedSports &&
        typeof selectedSports === "object"
    ) {
        for (const key of Object.keys(selectedSports)) {
            const item = selectedSports[key];

            if (isSelected(item)) {
                const id = toPositiveInteger(
                    item && typeof item === "object"
                        ? (item.id || key)
                        : key
                );

                if (id !== null) {
                    result.add(id);
                }
            }
        }
    }

    if (
        result.size === 0 &&
        (selectedSports === undefined || selectedSports === null)
    ) {
        const oldId = toPositiveInteger(settings.selected_sport);

        if (oldId !== null) {
            result.add(oldId);
        }
    }

    return Array.from(result);
}

// ==================================================
// FETCH GAMES
// ==================================================

async function fetchGames(apiUrl, sportId, date) {
    const url = buildBaseUrl(apiUrl);

    url.searchParams.set("sports", String(sportId));
    url.searchParams.set("startDate", formatApiDate(date));
    url.searchParams.set("endDate", formatApiDate(date));

    console.log(
        "Fetching games:",
        "sport=" + sportId,
        "date=" + formatApiDate(date)
    );

    const data = await fetchJson(url.toString());

    if (!data || !Array.isArray(data.games)) {
        console.log("No games array returned");
        return [];
    }

    console.log("Games received:", data.games.length);

    return data.games.map(function (game) {
        if (getSportId(game) === null) {
            game._syncSportId = sportId;
        }

        return game;
    });
}

// ==================================================
// MATCH STATUS
// ==================================================

function getMatchStatus(game) {
    const text = String(
        game.statusText || ""
    ).trim();

    const shortText = String(
        game.shortStatusText || text
    ).trim();

    const normalized = (
        text + " " + shortText
    ).toLowerCase();

    if (
        normalized.includes("postponed") ||
        normalized.includes("ppd")
    ) {
        return {
            status: "Postponed",
            shortStatus: "PPD"
        };
    }

    if (
        normalized.includes("cancelled") ||
        normalized.includes("canceled") ||
        normalized.includes("canc")
    ) {
        return {
            status: "Cancelled",
            shortStatus: "CANC"
        };
    }

    if (
        normalized.includes("abandoned") ||
        normalized.includes("abd")
    ) {
        return {
            status: "Abandoned",
            shortStatus: "ABD"
        };
    }

    if (
        normalized.includes("penalties") ||
        normalized.includes("penalty shootout")
    ) {
        return {
            status: "After Penalties",
            shortStatus: "AP"
        };
    }

    if (
        normalized === "ht" ||
        normalized.includes("half time") ||
        normalized.includes("halftime")
    ) {
        return {
            status: "Half Time",
            shortStatus: "HT"
        };
    }

    if (
        normalized.includes("extra time") ||
        normalized === "et"
    ) {
        return {
            status: "Extra Time",
            shortStatus: "ET"
        };
    }

    if (
        normalized.includes("live") ||
        normalized.includes("in progress") ||
        normalized.includes("1st half") ||
        normalized.includes("2nd half") ||
        normalized.includes("quarter") ||
        normalized.includes("period")
    ) {
        return {
            status: "Live",
            shortStatus: shortText || "LIVE"
        };
    }

    if (
        normalized.includes("ended") ||
        normalized.includes("finished") ||
        normalized.includes("final") ||
        normalized === "ft"
    ) {
        return {
            status: "Finished",
            shortStatus: "FT"
        };
    }

    return {
        status: text || "Upcoming",
        shortStatus: shortText || "NS"
    };
}

// ==================================================
// CONVERT MATCH
// ==================================================

function convertMatch(game, oldMatch, requestedSportId) {
    const gameId = toPositiveInteger(game.id);

    const home = getTeam(game, "home");
    const away = getTeam(game, "away");

    const homeId = toPositiveInteger(home.id);
    const awayId = toPositiveInteger(away.id);

    const startTime = getGameStartTime(game);
    const timestamp = Date.parse(startTime);

    if (
        gameId === null ||
        !Number.isFinite(timestamp)
    ) {
        return null;
    }

    const homeScore = getTeamScore(home);
    const awayScore = getTeamScore(away);

    const old = oldMatch || {};
    const status = getMatchStatus(game);

    const competition = game.competition;

    const league =
        game.competitionDisplayName ||
        game.competitionName ||
        (
            competition && typeof competition === "object"
                ? competition.name
                : typeof competition === "string"
                    ? competition
                    : ""
        ) ||
        old.league ||
        "Unknown Competition";

    return Object.assign({}, old, {
        gameId: gameId,

        competitionId: getGameCompetitionId(game) || 0,
        sportId: getSportId(game) || requestedSportId || 1,

        league: String(league),

        home: getTeamName(home) || old.home || "Home",
        away: getTeamName(away) || old.away || "Away",

        homeLogo: homeId
            ? IMAGE_URL + homeId
            : (old.homeLogo || ""),

        awayLogo: awayId
            ? IMAGE_URL + awayId
            : (old.awayLogo || ""),

        score: homeScore !== "" && awayScore !== ""
            ? homeScore + " - " + awayScore
            : "VS",

        status: status.status,
        shortStatus: status.shortStatus,

        date: formatMatchDate(startTime),
        time: formatMatchTime(startTime),
        matchTimeMillis: timestamp,

        stadium: game.venueName || old.stadium || "",

        // Preserve manually added admin data.
        streamUrl: typeof old.streamUrl === "string"
            ? old.streamUrl
            : ""
    });
}

// ==================================================
// MAIN
// ==================================================

async function main() {
    const db = initializeFirebase();

    console.log("==================================");
    console.log("SportsHub 365Scores Sync");
    console.log("==================================");

    const settingsSnapshot = await db.ref("settings").once("value");
    const settings = settingsSnapshot.val() || {};

    const selectedParser = String(
        settings.selected_parser || "parse1"
    );

    const parserConfig =
        settings.parse &&
        settings.parse[selectedParser]
            ? settings.parse[selectedParser]
            : {};

    const apiParser = String(
        parserConfig.api_parser || ""
    ).trim().toLowerCase();

    const apiUrl = String(
        parserConfig.api_url || DEFAULT_API_URL
    ).trim();

    if (
        apiParser &&
        apiParser !== "365" &&
        apiParser !== "365scores"
    ) {
        throw new Error(
            "Selected parser is not 365Scores: " + apiParser
        );
    }

    const selectedSportIds = normalizeSportIds(settings);
    const selectedSportSet = new Set(selectedSportIds);

    console.log("Selected sport IDs:", selectedSportIds);

    if (selectedSportIds.length === 0) {
        throw new Error(
            "No sports selected in settings/selected_sports"
        );
    }

    const catalog = await fetchSportsAndCompetitions(apiUrl);

    const allSports = catalog.sports;
    const allCompetitions = catalog.competitions;

    const snapshots = await Promise.all([
        db.ref("sports").once("value"),
        db.ref("competition_selection").once("value"),
        db.ref("competitions").once("value"),
        db.ref("matches").once("value")
    ]);

    const existingSports = snapshots[0].val() || {};
    const existingSelection = snapshots[1].val() || {};
    const existingCompetitions = snapshots[2].val() || {};
    const existingMatches = snapshots[3].val() || {};

    // ----------------------------------------------
    // UPDATE SPORTS
    // ----------------------------------------------

    const sportsUpdates = {};

    for (const sport of allSports) {
        const id = toPositiveInteger(sport.id);

        if (id === null) {
            continue;
        }

        const key = String(id);
        const old = existingSports[key] || {};

        sportsUpdates[key] = Object.assign({}, old, {
            id: id,
            name: sport.name || old.name || "",
            nameForURL: sport.nameForURL || old.nameForURL || "",
            totalGames: Number(sport.totalGames || 0),
            liveGames: Number(sport.liveGames || 0),
            imageVersion: Number(sport.imageVersion || 0)
        });
    }

    // ----------------------------------------------
    // UPDATE COMPETITIONS
    // ----------------------------------------------

    const competitionUpdates = {};
    const selectionUpdates = {};
    let newCompetitionCount = 0;

    for (const item of allCompetitions) {
        const id = getCompetitionId(item);
        const sportId = getSportId(item);

        if (id === null || sportId === null) {
            continue;
        }

        if (!selectedSportSet.has(sportId)) {
            continue;
        }

        const key = String(id);
        const old = existingCompetitions[key] || {};

        let selected;

        if (
            Object.prototype.hasOwnProperty.call(
                existingSelection,
                key
            )
        ) {
            selected = isSelected(existingSelection[key]);
        } else {
            selected = isSelected(old.selected);
            selectionUpdates[key] = selected;
        }

        competitionUpdates[key] = Object.assign({}, old, {
            id: id,
            name: getCompetitionName(item),
            sportId: sportId,
            countryId: toPositiveInteger(item.countryId),
            nameForURL: item.nameForURL || old.nameForURL || "",
            selected: selected,
            totalGames: Number(item.totalGames || 0),
            liveGames: Number(item.liveGames || 0),
            hasStandings: item.hasStandings === true,
            hasBrackets: item.hasBrackets === true,
            imageVersion: Number(item.imageVersion || 0)
        });

        if (!old.id) {
            newCompetitionCount++;
        }
    }

    const catalogUpdates = {};

    for (const key of Object.keys(sportsUpdates)) {
        catalogUpdates["sports/" + key] = sportsUpdates[key];
    }

    for (const key of Object.keys(competitionUpdates)) {
        catalogUpdates["competitions/" + key] =
            competitionUpdates[key];
    }

    for (const key of Object.keys(selectionUpdates)) {
        catalogUpdates["competition_selection/" + key] =
            selectionUpdates[key];
    }

    if (Object.keys(catalogUpdates).length > 0) {
        await db.ref().update(catalogUpdates);
    }

    console.log("Sports updated:", Object.keys(sportsUpdates).length);
    console.log(
        "Competitions updated:",
        Object.keys(competitionUpdates).length
    );
    console.log("New competitions:", newCompetitionCount);

    // ----------------------------------------------
    // FETCH GAMES
    // ----------------------------------------------

    const discoveredGames = [];
    let successfulRequests = 0;

    for (const sportId of selectedSportIds) {
        for (const offset of [-1, 0, 1]) {
            const date = getDateOffset(offset);

            try {
                const games = await fetchGames(
                    apiUrl,
                    sportId,
                    date
                );

                discoveredGames.push.apply(
                    discoveredGames,
                    games
                );

                successfulRequests++;

            } catch (error) {
                console.error(
                    "Games request failed:",
                    "sport=" + sportId,
                    "date=" + formatApiDate(date),
                    error.message
                );
            }

            await delay(REQUEST_DELAY);
        }
    }

    if (successfulRequests === 0) {
        throw new Error(
            "All games API requests failed; matches were not changed."
        );
    }

    // ----------------------------------------------
    // RESOLVE SELECTIONS
    // ----------------------------------------------

    const effectiveSelection = Object.assign(
        {},
        existingSelection,
        selectionUpdates
    );

    function isCompetitionSelected(competitionId) {
        const key = String(competitionId);

        // The explicit selection node is authoritative.
        if (
            Object.prototype.hasOwnProperty.call(
                effectiveSelection,
                key
            )
        ) {
            return isSelected(effectiveSelection[key]);
        }

        const competition =
            competitionUpdates[key] ||
            existingCompetitions[key];

        return !!competition && isSelected(competition.selected);
    }

    const selectedCompetitionKeys =
        Object.keys(effectiveSelection).filter(function (key) {
            return isSelected(effectiveSelection[key]);
        });

    console.log(
        "Selected competition count:",
        selectedCompetitionKeys.length
    );

    console.log(
        "Selected competition IDs:",
        selectedCompetitionKeys.join(", ")
    );

    // ----------------------------------------------
    // PREPARE MATCH UPDATES
    // ----------------------------------------------

    const matchUpdates = {};
    const seenGames = new Set();

    let skippedNoId = 0;
    let skippedSport = 0;
    let skippedUnselected = 0;
    let skippedInvalidMatch = 0;
    let debugCount = 0;

    for (const game of discoveredGames) {
        const gameId = toPositiveInteger(game.id);

        const sportId =
            getSportId(game) ||
            toPositiveInteger(game._syncSportId);

        const competitionId = getGameCompetitionId(game);

        if (
            gameId === null ||
            sportId === null ||
            competitionId === null
        ) {
            skippedNoId++;
            continue;
        }

        if (!selectedSportSet.has(sportId)) {
            skippedSport++;
            continue;
        }

        const selected = isCompetitionSelected(competitionId);

        if (!selected && debugCount < 5) {
            console.log("SELECTION DEBUG:", JSON.stringify({
                gameId: gameId,
                sportId: sportId,
                gameCompetitionId: competitionId,
                gameCompetitionName:
                    game.competitionDisplayName ||
                    game.competitionName ||
                    "",
                firebaseSelection:
                    effectiveSelection[String(competitionId)],
                firebaseCompetition:
                    competitionUpdates[String(competitionId)] ||
                    existingCompetitions[String(competitionId)] ||
                    null
            }));

            debugCount++;
        }

        if (!selected) {
            skippedUnselected++;
            continue;
        }

        const gameKey = String(gameId);

        if (seenGames.has(gameKey)) {
            continue;
        }

        seenGames.add(gameKey);

        const converted = convertMatch(
            game,
            existingMatches[gameKey] || {},
            sportId
        );

        if (!converted) {
            skippedInvalidMatch++;
            continue;
        }

        matchUpdates[gameKey] = converted;
    }

    // ----------------------------------------------
    // WRITE MATCHES
    // ----------------------------------------------

    const matchKeys = Object.keys(matchUpdates);

    if (matchKeys.length > 0) {
        await db.ref("matches").update(matchUpdates);
    }

    // ----------------------------------------------
    // SUMMARY
    // ----------------------------------------------

    console.log("==================================");
    console.log("365Scores Sync Completed");
    console.log("Selected sport count:", selectedSportIds.length);
    console.log("Sports updated:", Object.keys(sportsUpdates).length);
    console.log(
        "Competitions updated:",
        Object.keys(competitionUpdates).length
    );
    console.log("New competitions:", newCompetitionCount);
    console.log("Successful games requests:", successfulRequests);
    console.log("Games received:", discoveredGames.length);
    console.log("Skipped - missing IDs:", skippedNoId);
    console.log("Skipped - unselected sports:", skippedSport);
    console.log(
        "Skipped - unselected competitions:",
        skippedUnselected
    );
    console.log("Skipped - invalid matches:", skippedInvalidMatch);
    console.log("Selected matches synced:", matchKeys.length);
    console.log("==================================");

    if (matchKeys.length === 0) {
        console.log(
            "No matches were saved. Review SELECTION DEBUG above."
        );
    }
}

// ==================================================
// RUN
// ==================================================

main()
    .then(async function () {
        if (admin.apps.length > 0) {
            await admin.app().delete();
        }

        process.exit(0);
    })
    .catch(async function (error) {
        console.error(
            "365Scores sync failed:",
            error.stack || error.message
        );

        if (admin.apps.length > 0) {
            try {
                await admin.app().delete();
            } catch (e) {
                console.error(e.message);
            }
        }

        process.exit(1);
    });
