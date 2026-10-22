"use strict";

const admin = require("firebase-admin");

// ==================================================
// CONSTANTS
// ==================================================

const DEFAULT_API_URL =
    "https://webws.365scores.com/web/games/";

const IMAGE_URL =
    "https://imagecache.365scores.com/image/upload/f_auto,w_120,h_120,c_limit,q_auto:eco/v2/competitors/";

const TIME_ZONE = "Asia/Kolkata";

const REQUEST_TIMEOUT = 30000;
const REQUEST_DELAY = 500;

const HEADERS = {
    "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36",
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

    const serviceAccountJson =
        process.env.FIREBASE_SERVICE_ACCOUNT;

    const databaseURL =
        process.env.FIREBASE_DATABASE_URL;

    if (!serviceAccountJson) {
        throw new Error(
            "Missing FIREBASE_SERVICE_ACCOUNT secret"
        );
    }

    if (!databaseURL) {
        throw new Error(
            "Missing FIREBASE_DATABASE_URL secret"
        );
    }

    admin.initializeApp({
        credential: admin.credential.cert(
            JSON.parse(serviceAccountJson)
        ),
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

function getDateParts(date) {

    const parts =
        new Intl.DateTimeFormat("en-GB", {
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

function formatMatchDate(dateValue) {

    const date = new Date(dateValue);

    if (isNaN(date.getTime())) {
        return "";
    }

    const p = getDateParts(date);

    return p.day + "-" + p.month + "-" + p.year;
}

function formatMatchTime(dateValue) {

    const date = new Date(dateValue);

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

    const parts =
        new Intl.DateTimeFormat("en-GB", {
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
        12,
        0,
        0
    ));
}

function toPositiveInteger(value) {

    const number = Number(value);

    return Number.isInteger(number) && number > 0
        ? number
        : null;
}

function getCompetitionId(competition) {

    return toPositiveInteger(
        competition && competition.id
    );
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

function getSportId(item) {

    return toPositiveInteger(
        item && item.sportId
    );
}

function firebaseKey(value) {

    return String(value).replace(/[.#$\[\]\/]/g, "_");
}

// ==================================================
// FETCH JSON
// ==================================================

async function fetchJson(url) {

    const response = await fetch(url, {
        method: "GET",
        headers: HEADERS,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT)
    });

    if (!response.ok) {
        throw new Error(
            "HTTP " + response.status + " - " + url
        );
    }

    return await response.json();
}

// ==================================================
// BUILD GAMES URL
// ==================================================

function buildGamesUrl(apiUrl, sportId, date) {

    const url = new URL(apiUrl);

    url.searchParams.set("appTypeId", "5");
    url.searchParams.set("langId", "1");
    url.searchParams.set("timezoneName", TIME_ZONE);
    url.searchParams.set("userCountryId", "113");
    url.searchParams.set("sports", String(sportId));
    url.searchParams.set("startDate", formatApiDate(date));
    url.searchParams.set("endDate", formatApiDate(date));
    url.searchParams.set("showOdds", "true");
    url.searchParams.set("onlyMajorGames", "false");
    url.searchParams.set("withTop", "true");

    return url.toString();
}

// ==================================================
// FETCH GAMES
// ==================================================

async function fetchGames(apiUrl, sportId, date) {

    const url = buildGamesUrl(
        apiUrl,
        sportId,
        date
    );

    console.log(
        "Fetching games:",
        "sport=" + sportId,
        "date=" + formatApiDate(date)
    );

    const data = await fetchJson(url);

    if (!data || !Array.isArray(data.games)) {
        console.log("No games array returned");
        return [];
    }

    console.log(
        "Games received:",
        data.games.length
    );

    return data.games;
}

// ==================================================
// FETCH SPORTS AND COMPETITIONS
// ==================================================

async function fetchSportsAndCompetitions(apiUrl) {

    const url = new URL(apiUrl);

    url.searchParams.set("appTypeId", "5");
    url.searchParams.set("langId", "1");
    url.searchParams.set("timezoneName", TIME_ZONE);
    url.searchParams.set("userCountryId", "113");
    url.searchParams.set("showOdds", "true");
    url.searchParams.set("onlyMajorGames", "false");
    url.searchParams.set("withTop", "true");

    console.log(
        "Fetching sports and competitions"
    );

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

    console.log(
        "API sports:",
        data.sports.length
    );

    console.log(
        "API competitions:",
        data.competitions.length
    );

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

    const selectedSports =
        settings.selected_sports;

    if (Array.isArray(selectedSports)) {

        for (let i = 0; i < selectedSports.length; i++) {

            const item = selectedSports[i];

            // Support an array of sport IDs.
            if (
                typeof item === "number" ||
                typeof item === "string"
            ) {
                const id = toPositiveInteger(item);

                if (id !== null) {
                    result.add(id);
                }

                continue;
            }

            // Support an array of objects.
            if (item && typeof item === "object") {

                const id = toPositiveInteger(item.id);

                if (id !== null) {
                    result.add(id);
                }
            }
        }

    } else if (
        selectedSports &&
        typeof selectedSports === "object"
    ) {

        for (const key of Object.keys(selectedSports)) {

            const item = selectedSports[key];

            // The Android app saves { "1": true, "2": false }.
            if (item === true) {

                const id = toPositiveInteger(key);

                if (id !== null) {
                    result.add(id);
                }

                continue;
            }

            // Also support { "1": { "selected": true } }.
            if (item && typeof item === "object") {

                if (item.selected === false) {
                    continue;
                }

                const id = toPositiveInteger(
                    item.id || key
                );

                if (id !== null) {
                    result.add(id);
                }
            }
        }
    }

    // Support older array-based settings:
    // [null, true, true, false, ...]
    // In this format, the array index represents the sport ID.
    if (
        Array.isArray(selectedSports) &&
        selectedSports.some(function (item, index) {
            return item === true && index > 0;
        })
    ) {

        for (let i = 1; i < selectedSports.length; i++) {

            if (selectedSports[i] === true) {
                result.add(i);
            }
        }
    }

    // Legacy fallback only when no selection data exists.
    if (
        result.size === 0 &&
        (
            selectedSports === undefined ||
            selectedSports === null
        )
    ) {

        const selectedSport =
            toPositiveInteger(settings.selected_sport);

        if (selectedSport !== null) {
            result.add(selectedSport);
        }
    }

    return Array.from(result);
}

// ==================================================
// MATCH STATUS
// ==================================================

function getMatchStatus(game) {

    const text =
        String(game.statusText || "").trim();

    const shortText =
        String(
            game.shortStatusText || text
        ).trim();

    const normalized =
        (text + " " + shortText).toLowerCase();

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

function convertMatch(game, oldMatch) {

    const gameId =
        toPositiveInteger(game.id);

    const home =
        game.homeCompetitor || {};

    const away =
        game.awayCompetitor || {};

    const homeId =
        toPositiveInteger(home.id) || 0;

    const awayId =
        toPositiveInteger(away.id) || 0;

    const startTime =
        game.startTime || "";

    const timestamp =
        Date.parse(startTime);

    if (
        gameId === null ||
        !Number.isFinite(timestamp)
    ) {
        return null;
    }

    const homeScore =
        home.score === undefined ||
        home.score === null
            ? ""
            : home.score;

    const awayScore =
        away.score === undefined ||
        away.score === null
            ? ""
            : away.score;

    const status =
        getMatchStatus(game);

    const previous =
        oldMatch || {};

    const previousFields = {};

    const protectedFields = [
        "streamUrl",
        "goalEvents",
        "adminNotes"
    ];

    for (const key of protectedFields) {

        if (
            Object.prototype.hasOwnProperty.call(
                previous,
                key
            )
        ) {
            previousFields[key] = previous[key];
        }
    }

    return Object.assign(
        {},
        previousFields,
        {
            gameId: gameId,

            sportId:
                toPositiveInteger(game.sportId) || 1,

            competitionId:
                toPositiveInteger(game.competitionId),

            league:
                game.competitionDisplayName ||
                game.competitionName ||
                (
                    game.competition &&
                    typeof game.competition === "object"
                        ? game.competition.name
                        : game.competition
                ) ||
                "Unknown Competition",

            home:
                home.name || "Home",

            away:
                away.name || "Away",

            homeCompetitorId:
                homeId,

            awayCompetitorId:
                awayId,

            homeLogo:
                homeId > 0
                    ? IMAGE_URL + homeId
                    : "",

            awayLogo:
                awayId > 0
                    ? IMAGE_URL + awayId
                    : "",

            score:
                homeScore !== "" &&
                awayScore !== ""
                    ? homeScore + " - " + awayScore
                    : "VS",

            status:
                status.status,

            shortStatus:
                status.shortStatus,

            date:
                formatMatchDate(startTime),

            time:
                formatMatchTime(startTime),

            matchTimeMillis:
                timestamp,

            stadium:
                game.venueName || "",

            streamUrl:
                typeof previous.streamUrl === "string"
                    ? previous.streamUrl
                    : ""
        }
    );
}

// ==================================================
// MAIN
// ==================================================

async function main() {

    const db = initializeFirebase();

    console.log("==================================");
    console.log("SportsHub 365Scores Sync");
    console.log("==================================");

    // ----------------------------------------------
    // READ SETTINGS
    // ----------------------------------------------

    const settingsSnapshot =
        await db.ref("settings").once("value");

    const settings =
        settingsSnapshot.val() || {};

    const selectedParser =
        String(settings.selected_parser || "parse1");

    const parserConfig =
        settings.parse &&
        settings.parse[selectedParser]
            ? settings.parse[selectedParser]
            : {};

    const apiParser =
        String(parserConfig.api_parser || "")
            .trim()
            .toLowerCase();

    const apiUrl =
        String(
            parserConfig.api_url || DEFAULT_API_URL
        ).trim();

    if (
        apiParser &&
        apiParser !== "365" &&
        apiParser !== "365scores"
    ) {
        throw new Error(
            "Selected parser is not 365Scores: " +
            apiParser
        );
    }

    if (!apiUrl) {
        throw new Error(
            "365Scores api_url is empty"
        );
    }

    const selectedSportIds =
        normalizeSportIds(settings);

    console.log(
        "Selected sport IDs:",
        selectedSportIds
    );

    if (selectedSportIds.length === 0) {

        throw new Error(
            "No sports selected in settings/selected_sports"
        );
    }

    // ----------------------------------------------
    // FETCH CATALOG
    // ----------------------------------------------

    const catalog =
        await fetchSportsAndCompetitions(apiUrl);

    const allSports =
        catalog.sports;

    const allCompetitions =
        catalog.competitions;

    const selectedSportSet =
        new Set(selectedSportIds);

    // ----------------------------------------------
    // READ EXISTING FIREBASE DATA
    // ----------------------------------------------

    const existingSportsSnapshot =
        await db.ref("sports").once("value");

    const existingSports =
        existingSportsSnapshot.val() || {};

    const selectionSnapshot =
        await db.ref("competition_selection")
            .once("value");

    const existingSelection =
        selectionSnapshot.val() || {};

    const competitionsSnapshot =
        await db.ref("competitions").once("value");

    const existingCompetitions =
        competitionsSnapshot.val() || {};

    const matchesSnapshot =
        await db.ref("matches").once("value");

    const existingMatches =
        matchesSnapshot.val() || {};

    // ----------------------------------------------
    // PREPARE SPORTS UPDATES
    // ----------------------------------------------

    const sportsUpdates = {};
    const selectedSportNames = {};

    for (const sport of allSports) {

        const sportId =
            toPositiveInteger(sport.id);

        if (sportId === null) {
            continue;
        }

        const key = String(sportId);

        const oldSport =
            existingSports[key] || {};

        sportsUpdates[key] = Object.assign(
            {},
            oldSport,
            {
                id: sportId,
                name: sport.name || oldSport.name || "",
                nameForURL:
                    sport.nameForURL ||
                    oldSport.nameForURL ||
                    "",
                totalGames:
                    Number(sport.totalGames || 0),
                liveGames:
                    Number(sport.liveGames || 0),
                imageVersion:
                    Number(sport.imageVersion || 0)
            }
        );

        if (selectedSportSet.has(sportId)) {
            selectedSportNames[sportId] =
                sport.name || String(sportId);
        }
    }

    // ----------------------------------------------
    // PREPARE COMPETITION UPDATES
    // ----------------------------------------------

    const competitionUpdates = {};
    const selectionUpdates = {};

    let newCompetitionCount = 0;

    for (const competition of allCompetitions) {

        const competitionId =
            getCompetitionId(competition);

        const sportId =
            getSportId(competition);

        if (
            competitionId === null ||
            sportId === null
        ) {
            continue;
        }

        // Only store competitions belonging to
        // sports selected in SportActivity.
        if (!selectedSportSet.has(sportId)) {
            continue;
        }

        const key =
            String(competitionId);

        const oldCompetition =
            existingCompetitions[key] || {};

        let selected = false;

        if (
            Object.prototype.hasOwnProperty.call(
                existingSelection,
                key
            )
        ) {

            selected =
                existingSelection[key] === true;

        } else {

            selected =
                oldCompetition.selected === true;

            selectionUpdates[key] =
                selected;
        }

        competitionUpdates[key] = {
            id: competitionId,
            name: getCompetitionName(competition),
            sportId: sportId,
            countryId:
                toPositiveInteger(competition.countryId),
            nameForURL:
                competition.nameForURL || "",
            selected: selected,
            totalGames:
                Number(competition.totalGames || 0),
            liveGames:
                Number(competition.liveGames || 0),
            hasStandings:
                competition.hasStandings === true,
            hasBrackets:
                competition.hasBrackets === true,
            imageVersion:
                Number(competition.imageVersion || 0)
        };

        if (!oldCompetition.id) {
            newCompetitionCount++;
        }
    }

    // ----------------------------------------------
    // WRITE SPORTS AND COMPETITIONS
    // ----------------------------------------------

    // Do not delete old sports or competitions.
    // Existing records outside this API response
    // remain untouched.

    const catalogUpdates = {};

    for (const key of Object.keys(sportsUpdates)) {
        catalogUpdates["sports/" + key] =
            sportsUpdates[key];
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

    console.log(
        "Sports updated:",
        Object.keys(sportsUpdates).length
    );

    console.log(
        "Selected sports:",
        selectedSportIds
    );

    console.log(
        "Competitions updated:",
        Object.keys(competitionUpdates).length
    );

    console.log(
        "New competitions:",
        newCompetitionCount
    );

    // ----------------------------------------------
    // FETCH MATCHES
    // ----------------------------------------------

    const discoveredGames = [];

    let successfulRequests = 0;

    for (const sportId of selectedSportIds) {

        for (const offset of [-1, 0, 1]) {

            const date =
                getDateOffset(offset);

            try {

                const games =
                    await fetchGames(
                        apiUrl,
                        sportId,
                        date
                    );

                discoveredGames.push(...games);

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
            "All games API requests failed. " +
            "Catalog was updated, but matches were not changed."
        );
    }

    // ----------------------------------------------
    // PREPARE MATCH UPDATES
    // ----------------------------------------------

    const matchUpdates = {};
    const seenGames = new Set();

    let selectedGameCount = 0;

    // Use the updated competition selection, but keep
    // existing flags for competitions not returned
    // in this API response.
    const effectiveSelection = Object.assign(
        {},
        existingSelection,
        selectionUpdates
    );

    for (const game of discoveredGames) {

        const gameId =
            toPositiveInteger(game.id);

        const sportId =
            toPositiveInteger(game.sportId);

        const competitionId =
            toPositiveInteger(game.competitionId);

        if (
            gameId === null ||
            sportId === null ||
            competitionId === null
        ) {
            continue;
        }

        if (!selectedSportSet.has(sportId)) {
            continue;
        }

        const competitionKey =
            String(competitionId);

        const competition =
            competitionUpdates[competitionKey] ||
            existingCompetitions[competitionKey] ||
            {};

        const selected =
            Object.prototype.hasOwnProperty.call(
                effectiveSelection,
                competitionKey
            )
                ? effectiveSelection[competitionKey] === true
                : competition.selected === true;

        if (!selected) {
            continue;
        }

        const gameKey =
            String(gameId);

        if (seenGames.has(gameKey)) {
            continue;
        }

        seenGames.add(gameKey);

        const oldMatch =
            existingMatches[gameKey] || {};

        const match =
            convertMatch(game, oldMatch);

        if (!match) {
            continue;
        }

        matchUpdates[gameKey] = match;

        selectedGameCount++;
    }

    // ----------------------------------------------
    // WRITE MATCHES
    // ----------------------------------------------

    if (Object.keys(matchUpdates).length > 0) {

        await db.ref("matches")
            .update(matchUpdates);
    }

    // ----------------------------------------------
    // SUMMARY
    // ----------------------------------------------

    console.log("==================================");
    console.log("365Scores Sync Completed");
    console.log(
        "Selected sport count:",
        selectedSportIds.length
    );
    console.log(
        "Sports updated:",
        Object.keys(sportsUpdates).length
    );
    console.log(
        "Competitions updated:",
        Object.keys(competitionUpdates).length
    );
    console.log(
        "New competitions:",
        newCompetitionCount
    );
    console.log(
        "Successful games requests:",
        successfulRequests
    );
    console.log(
        "Games received:",
        discoveredGames.length
    );
    console.log(
        "Selected matches synced:",
        selectedGameCount
    );
    console.log("==================================");
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
