"use strict";

const admin = require("firebase-admin");

const DEFAULT_API_URL = "https://webws.365scores.com/web/games/";
const IMAGE_URL = "https://imagecache.365scores.com/image/upload/";

const TIME_ZONE = "Asia/Kolkata";
const REQUEST_TIMEOUT = 30000;
const REQUEST_DELAY = 500;

const PROVIDER = "365scores";

let db;

// --------------------------------------------------
// FIREBASE INITIALIZATION
// --------------------------------------------------

function initializeFirebase() {
    if (admin.apps.length > 0) {
        db = admin.database();
        return;
    }

    const serviceAccountText = process.env.FIREBASE_SERVICE_ACCOUNT;
    const databaseURL = process.env.FIREBASE_DATABASE_URL;

    if (!serviceAccountText || !databaseURL) {
        throw new Error("Firebase secrets are missing.");
    }

    let serviceAccount;

    try {
        serviceAccount = JSON.parse(serviceAccountText);
    } catch (error) {
        throw new Error("Invalid FIREBASE_SERVICE_ACCOUNT JSON.");
    }

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: databaseURL
    });

    db = admin.database();
}

// --------------------------------------------------
// COMMON HELPERS
// --------------------------------------------------

function sleep(ms) {
    return new Promise(function (resolve) {
        setTimeout(resolve, ms);
    });
}

function isObject(value) {
    return value !== null &&
        typeof value === "object" &&
        !Array.isArray(value);
}

function toNumber(value, fallback) {
    const n = Number(value);

    return Number.isFinite(n) ? n : fallback;
}

function toText(value, fallback) {
    if (value === undefined || value === null) {
        return fallback || "";
    }

    return String(value);
}

function cleanKey(value) {
    return String(value).replace(/[.#$[\]/]/g, "_");
}

function getFirstValue() {
    for (let i = 0; i < arguments.length; i++) {
        const value = arguments[i];

        if (
            value !== undefined &&
            value !== null &&
            value !== ""
        ) {
            return value;
        }
    }

    return null;
}

function normalizeBoolean(value) {
    if (value === true || value === 1 || value === "1") {
        return true;
    }

    return typeof value === "string" &&
        value.toLowerCase() === "true";
}

function getTimestamp(value) {
    if (value === undefined || value === null || value === "") {
        return 0;
    }

    if (typeof value === "number") {
        return value < 1000000000000 ? value * 1000 : value;
    }

    const numeric = Number(value);

    if (Number.isFinite(numeric) && numeric > 0) {
        return numeric < 1000000000000 ? numeric * 1000 : numeric;
    }

    const parsed = Date.parse(value);

    return Number.isFinite(parsed) ? parsed : 0;
}

// --------------------------------------------------
// SETTINGS
// --------------------------------------------------

async function getSettings() {
    const snapshot = await db.ref("settings").once("value");
    return snapshot.val() || {};
}

function getParserConfig(settings) {
    const parserKey = toText(
        settings.selected_parser,
        "parse1"
    ).toLowerCase();

    const parseSettings = isObject(settings.parse)
        ? settings.parse
        : {};

    const config = isObject(parseSettings[parserKey])
        ? parseSettings[parserKey]
        : {};

    return {
        selectedParser: parserKey,
        apiParser: toText(config.api_parser, "").toLowerCase(),
        apiUrl: toText(config.api_url, DEFAULT_API_URL)
    };
}

// --------------------------------------------------
// SELECTED SPORTS
// --------------------------------------------------

function normalizeSportIds(settings) {
    const result = [];
    const seen = {};

    function addSport(id, enabled) {
        if (!enabled) {
            return;
        }

        const sportId = toNumber(id, 0);

        if (sportId <= 0) {
            return;
        }

        const key = String(sportId);

        if (!seen[key]) {
            seen[key] = true;
            result.push(sportId);
        }
    }

    const selectedSports = settings.selected_sports;

    if (Array.isArray(selectedSports)) {
        selectedSports.forEach(function (item, index) {
            if (isObject(item)) {
                addSport(
                    getFirstValue(item.id, item.sportId, item.sport_id),
                    item.selected !== false && item.enabled !== false
                );
            } else if (item === true || item === 1) {
                addSport(index, true);
            } else if (typeof item === "number") {
                addSport(item, true);
            } else if (typeof item === "string" && item.trim() !== "") {
                addSport(item, true);
            }
        });
    } else if (isObject(selectedSports)) {
        Object.keys(selectedSports).forEach(function (key) {
            const item = selectedSports[key];

            if (isObject(item)) {
                addSport(
                    getFirstValue(item.id, item.sportId, key),
                    item.selected !== false && item.enabled !== false
                );
            } else {
                addSport(key, normalizeBoolean(item));
            }
        });
    }

    if (result.length === 0 && settings.selected_sport !== undefined) {
        const legacy = settings.selected_sport;

        if (isObject(legacy)) {
            Object.keys(legacy).forEach(function (key) {
                addSport(key, normalizeBoolean(legacy[key]));
            });
        } else {
            addSport(legacy, true);
        }
    }

    return result;
}

// --------------------------------------------------
// DATE HELPERS - INDIA TIME
// --------------------------------------------------

function getIndiaDateParts(date) {
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).formatToParts(date);

    const result = {};

    parts.forEach(function (part) {
        if (part.type !== "literal") {
            result[part.type] = part.value;
        }
    });

    return {
        year: Number(result.year),
        month: Number(result.month),
        day: Number(result.day)
    };
}

function getDateOffset(offset) {
    const today = getIndiaDateParts(new Date());

    const date = new Date(Date.UTC(
        today.year,
        today.month - 1,
        today.day + offset
    ));

    return {
        year: date.getUTCFullYear(),
        month: date.getUTCMonth() + 1,
        day: date.getUTCDate()
    };
}

function formatApiDate(parts) {
    return String(parts.day).padStart(2, "0") + "/" +
        String(parts.month).padStart(2, "0") + "/" +
        String(parts.year);
}

function formatIsoDate(parts) {
    return String(parts.year) + "-" +
        String(parts.month).padStart(2, "0") + "-" +
        String(parts.day).padStart(2, "0");
}

function getIndiaDateFromTimestamp(timestamp) {
    if (!timestamp || timestamp <= 0) {
        return "";
    }

    const parts = getIndiaDateParts(new Date(timestamp));

    return formatIsoDate(parts);
}

function getAllowedDateMap() {
    const map = {};

    [-1, 0, 1].forEach(function (offset) {
        const parts = getDateOffset(offset);
        map[formatIsoDate(parts)] = true;
    });

    return map;
}

function isWithinAllowedDates(timestamp, allowedDateMap) {
    if (!timestamp || timestamp <= 0) {
        return false;
    }

    const indiaDate = getIndiaDateFromTimestamp(timestamp);

    return !!allowedDateMap[indiaDate];
}

// --------------------------------------------------
// API REQUEST
// --------------------------------------------------

async function requestJson(url) {
    const controller = new AbortController();

    const timeout = setTimeout(function () {
        controller.abort();
    }, REQUEST_TIMEOUT);

    try {
        const response = await fetch(url, {
            method: "GET",
            headers: {
                "Accept": "application/json",
                "User-Agent": "SportsHub/1.0"
            },
            signal: controller.signal
        });

        if (!response.ok) {
            throw new Error("HTTP " + response.status);
        }

        return await response.json();
    } finally {
        clearTimeout(timeout);
    }
}

function buildUrl(baseUrl, params) {
    const url = new URL(baseUrl);

    Object.keys(params).forEach(function (key) {
        const value = params[key];

        if (value !== undefined && value !== null && value !== "") {
            url.searchParams.set(key, String(value));
        }
    });

    return url.toString();
}

// --------------------------------------------------
// SPORTS AND COMPETITIONS
// --------------------------------------------------

async function fetchSportsAndCompetitions(apiUrl) {
    const url = buildUrl(apiUrl, {
        lang: "en",
        timezoneName: TIME_ZONE
    });

    const data = await requestJson(url);

    if (!data || !Array.isArray(data.sports)) {
        throw new Error("Invalid 365Scores sports catalog.");
    }

    if (!Array.isArray(data.competitions)) {
        throw new Error("Invalid 365Scores competitions catalog.");
    }

    return {
        sports: data.sports,
        competitions: data.competitions
    };
}

function getCompetitionId(competition) {
    return toNumber(
        getFirstValue(
            competition.id,
            competition.competitionId,
            competition.competition_id
        ),
        0
    );
}

function getSportId(item) {
    return toNumber(
        getFirstValue(
            item.sportId,
            item.sport_id,
            item.sport && item.sport.id
        ),
        0
    );
}

function getCompetitionName(competition) {
    return toText(
        getFirstValue(
            competition.name,
            competition.shortName,
            competition.displayName
        ),
        "Unknown Competition"
    );
}

function getSportName(sport) {
    return toText(
        getFirstValue(sport.name, sport.shortName, sport.displayName),
        "Unknown Sport"
    );
}

function getCompetitionLogo(competition) {
    const direct = getFirstValue(
        competition.logo,
        competition.image,
        competition.imageUrl,
        competition.logoUrl
    );

    if (direct) {
        return String(direct);
    }

    const imageId = getFirstValue(
        competition.imageId,
        competition.image_id
    );

    return imageId
        ? IMAGE_URL + "competitors/" + imageId
        : "";
}

function getSportLogo(sport) {
    return toText(
        getFirstValue(sport.logo, sport.image, sport.imageUrl),
        ""
    );
}

// --------------------------------------------------
// SAVE CATALOG WITHOUT RESETTING ADMIN SELECTION
// --------------------------------------------------

async function saveSportsAndCompetitions(
    sports,
    competitions,
    selectedSportIds
) {
    const oldSportsSnapshot = await db.ref("sports").once("value");
    const oldCompetitionsSnapshot = await db.ref("competitions").once("value");
    const selectionsSnapshot = await db.ref("competition_selection").once("value");

    const oldSports = oldSportsSnapshot.val() || {};
    const oldCompetitions = oldCompetitionsSnapshot.val() || {};
    const selections = selectionsSnapshot.val() || {};

    const selectedSportMap = {};

    selectedSportIds.forEach(function (id) {
        selectedSportMap[String(id)] = true;
    });

    const sportUpdates = {};
    const competitionUpdates = {};
    const selectionUpdates = {};

    sports.forEach(function (sport) {
        const id = toNumber(sport.id, 0);

        if (id <= 0) {
            return;
        }

        const key = String(id);
        const old = oldSports[key] || {};

        sportUpdates[key] = Object.assign({}, old, {
            id: id,
            name: getSportName(sport),
            logo: getSportLogo(sport),
            selected: !!selectedSportMap[key],
            apiProvider: PROVIDER,
            updatedAt: Date.now()
        });
    });

    competitions.forEach(function (competition) {
        const id = getCompetitionId(competition);

        if (id <= 0) {
            return;
        }

        const key = String(id);
        const sportId = getSportId(competition);
        const old = oldCompetitions[key] || {};

        const hasSelection = Object.prototype.hasOwnProperty.call(
            selections,
            key
        );

        const selected = hasSelection
            ? normalizeBoolean(selections[key])
            : normalizeBoolean(old.selected);

        const sport = sports.find(function (item) {
            return Number(item.id) === sportId;
        });

        competitionUpdates[key] = Object.assign({}, old, {
            id: id,
            competitionId: id,
            sportId: sportId,
            sportName: sport ? getSportName(sport) : "",
            name: getCompetitionName(competition),
            logo: getCompetitionLogo(competition),
            selected: selected,
            apiProvider: PROVIDER,
            updatedAt: Date.now()
        });

        if (!hasSelection) {
            selectionUpdates[key] = selected;
        }
    });

    if (Object.keys(sportUpdates).length > 0) {
        await db.ref("sports").update(sportUpdates);
    }

    if (Object.keys(competitionUpdates).length > 0) {
        await db.ref("competitions").update(competitionUpdates);
    }

    if (Object.keys(selectionUpdates).length > 0) {
        await db.ref("competition_selection").update(selectionUpdates);
    }

    return {
        oldCompetitions: oldCompetitions
    };
}

// --------------------------------------------------
// MATCH STATUS
// --------------------------------------------------

function getMatchStatus(game) {
    const statusObject = isObject(game.status) ? game.status : {};

    const statusText = toText(
        getFirstValue(
            statusObject.text,
            statusObject.name,
            statusObject.shortName,
            game.statusText,
            game.statusName,
            typeof game.status === "string" ? game.status : null,
            game.gameStatus
        ),
        ""
    ).trim();

    const statusCode = toText(
        getFirstValue(
            statusObject.code,
            statusObject.id,
            game.statusCode,
            game.statusId,
            game.gameStatusCode
        ),
        ""
    ).toUpperCase();

    const combined = (statusText + " " + statusCode).toUpperCase();

    if (/\bFT\b|\bAET\b|\bPEN\b|FINISHED|ENDED|FULL TIME/.test(combined)) {
        return { status: "FT", shortStatus: "FT", live: false };
    }

    if (/\bCANC\b|CANCELLED|CANCELED/.test(combined)) {
        return { status: "CANC", shortStatus: "CANC", live: false };
    }

    if (/\bPOSTP\b|POSTPONED/.test(combined)) {
        return { status: "PPD", shortStatus: "PPD", live: false };
    }

    if (/\bABD\b|ABANDONED/.test(combined)) {
        return { status: "ABD", shortStatus: "ABD", live: false };
    }

    if (/\bHT\b|HALF TIME|HALFTIME/.test(combined)) {
        return { status: "HT", shortStatus: "HT", live: true };
    }

    if (/\b1H\b|FIRST HALF|1ST HALF/.test(combined)) {
        return { status: "1H", shortStatus: "LIVE", live: true };
    }

    if (/\b2H\b|SECOND HALF|2ND HALF/.test(combined)) {
        return { status: "2H", shortStatus: "LIVE", live: true };
    }

    if (/\bET\b|EXTRA TIME/.test(combined)) {
        return { status: "ET", shortStatus: "LIVE", live: true };
    }

    if (/\bLIVE\b|\bIN PLAY\b|\bINPLAY\b|\bPLAYING\b|\bQ[1-4]\b|\bOT\b/.test(combined)) {
        return {
            status: statusText || "LIVE",
            shortStatus: "LIVE",
            live: true
        };
    }

    const gameTime = getFirstValue(
        game.gameTime,
        game.time,
        game.startTime
    );

    if (gameTime !== null) {
        const timeText = String(gameTime).toUpperCase();

        if (timeText.indexOf("'") !== -1 || /^\d+$/.test(timeText)) {
            return { status: timeText, shortStatus: "LIVE", live: true };
        }
    }

    return {
        status: statusText || "NS",
        shortStatus: "NS",
        live: false
    };
}

// --------------------------------------------------
// TEAM HELPERS
// --------------------------------------------------

function getTeamObject(game, side) {
    const value = side === "home"
        ? getFirstValue(game.homeCompetitor, game.homeTeam, game.home)
        : getFirstValue(game.awayCompetitor, game.awayTeam, game.away);

    return isObject(value) ? value : {};
}

function getTeamName(game, side) {
    const team = getTeamObject(game, side);

    return toText(
        getFirstValue(
            team.name,
            team.shortName,
            team.displayName,
            team.title,
            side === "home" ? game.homeCompetitorName : game.awayCompetitorName,
            side === "home" ? game.homeTeamName : game.awayTeamName
        ),
        side === "home" ? "Home" : "Away"
    );
}

function getTeamId(game, side) {
    const team = getTeamObject(game, side);

    return toText(
        getFirstValue(
            team.id,
            team.competitorId,
            team.teamId,
            side === "home" ? game.homeCompetitorId : game.awayCompetitorId,
            side === "home" ? game.homeTeamId : game.awayTeamId
        ),
        ""
    );
}

function getTeamLogo(game, side, oldMatch) {
    const team = getTeamObject(game, side);

    const direct = getFirstValue(
        team.logo,
        team.image,
        team.imageUrl,
        team.logoUrl,
        team.imagePath
    );

    if (direct) {
        return String(direct);
    }

    const imageId = getFirstValue(team.imageId, team.image_id);

    if (imageId) {
        return IMAGE_URL + "competitors/" + imageId;
    }

    return toText(
        side === "home"
            ? getFirstValue(oldMatch.homeLogo, oldMatch.homeTeamLogo)
            : getFirstValue(oldMatch.awayLogo, oldMatch.awayTeamLogo),
        ""
    );
}

function getScore(game, side) {
    const team = getTeamObject(game, side);

    const value = getFirstValue(
        team.score,
        team.currentScore,
        team.goals,
        side === "home" ? game.homeScore : game.awayScore,
        side === "home" ? game.homeCompetitorScore : game.awayCompetitorScore
    );

    const score = Number(value);

    return Number.isFinite(score) ? score : 0;
}

// --------------------------------------------------
// MATCH CONVERSION
// --------------------------------------------------

function convertMatch(game, oldMatch, selectedCompetitionMap) {
    const id = toText(
        getFirstValue(game.id, game.gameId, game.fixtureId),
        ""
    );

    if (!id) {
        return null;
    }

    const competitionId = toNumber(
        getFirstValue(
            game.competitionId,
            game.competition && game.competition.id
        ),
        0
    );

    const sportId = getSportId(game);
    const statusInfo = getMatchStatus(game);

    const dateSource = getFirstValue(
        game.startDate,
        game.startTime,
        game.date,
        game.gameDate,
        game.startTimestamp,
        game.timestamp
    );

    const matchTimeMillis = getTimestamp(dateSource);

    const competition = isObject(game.competition)
        ? game.competition
        : {};

    const competitionName = toText(
        getFirstValue(
            competition.name,
            competition.shortName,
            game.competitionName,
            game.leagueName
        ),
        "Unknown Competition"
    );

    const home = getTeamName(game, "home");
    const away = getTeamName(game, "away");
    const homeLogo = getTeamLogo(game, "home", oldMatch);
    const awayLogo = getTeamLogo(game, "away", oldMatch);

    const elapsed = getFirstValue(
        game.gameTime,
        game.elapsed,
        game.minute,
        game.matchTime
    );

    const match = Object.assign({}, oldMatch, {
        gameId: id,
        apiFixtureId: id,
        apiProvider: PROVIDER,

        sportId: sportId,
        competitionId: competitionId,

        competition: competitionName,
        league: competitionName,
        competitionName: competitionName,

        home: home,
        away: away,
        homeTeam: home,
        awayTeam: away,

        homeTeamId: getTeamId(game, "home"),
        awayTeamId: getTeamId(game, "away"),

        homeScore: getScore(game, "home"),
        awayScore: getScore(game, "away"),

        homeLogo: homeLogo,
        awayLogo: awayLogo,
        homeTeamLogo: homeLogo,
        awayTeamLogo: awayLogo,

        status: statusInfo.status,
        shortStatus: statusInfo.shortStatus,
        isLive: statusInfo.live,

        elapsed: elapsed === null ? "" : String(elapsed),

        timestamp: matchTimeMillis || Date.now(),
        matchTimeMillis: matchTimeMillis,

        // Keep a consistent ISO date, as used by this script.
        date: matchTimeMillis > 0
            ? new Date(matchTimeMillis).toISOString()
            : "",

        competitionSelected: !!selectedCompetitionMap[String(competitionId)],

        updatedAt: Date.now()
    });

    match.streamUrl = toText(
        getFirstValue(game.streamUrl, oldMatch.streamUrl),
        ""
    );

    match.goalEvents = getFirstValue(
        game.goalEvents,
        oldMatch.goalEvents,
        []
    );

    match.adminNotes = toText(oldMatch.adminNotes, "");

    match.stadium = toText(
        getFirstValue(game.stadium, game.venue, oldMatch.stadium),
        ""
    );

    match.channels = getFirstValue(
        oldMatch.channels,
        game.channels,
        []
    );

    return match;
}

// --------------------------------------------------
// FETCH GAMES
// --------------------------------------------------

async function fetchGamesForDate(apiUrl, sportId, dateParts) {
    const params = {
        lang: "en",
        timezoneName: TIME_ZONE,
        startDate: formatApiDate(dateParts),
        endDate: formatApiDate(dateParts),
        sportId: sportId,
        onlyMajorGames: "false"
    };

    const url = buildUrl(apiUrl, params);

    console.log(
        "Fetching games:",
        "sport=" + sportId,
        "date=" + formatApiDate(dateParts)
    );

    const data = await requestJson(url);

    if (!data || !Array.isArray(data.games)) {
        throw new Error(
            "Invalid games response for sport=" + sportId +
            ", date=" + formatApiDate(dateParts)
        );
    }

    return data.games;
}

// --------------------------------------------------
// MAIN SYNC
// --------------------------------------------------

async function sync365Scores() {
    initializeFirebase();

    const settings = await getSettings();
    const parserConfig = getParserConfig(settings);

    if (
        parserConfig.selectedParser !== PROVIDER &&
        parserConfig.apiParser !== PROVIDER &&
        parserConfig.apiParser !== "365"
    ) {
        console.log("365Scores sync skipped; another API is selected.");
        return;
    }

    const selectedSportIds = normalizeSportIds(settings);

    if (selectedSportIds.length === 0) {
        throw new Error(
            "No selected sports found. Refusing to modify matches."
        );
    }

    const apiUrl = parserConfig.apiUrl || DEFAULT_API_URL;

    console.log("----------------------------------------");
    console.log("Sports Hub 365Scores Sync");
    console.log("Selected sports:", selectedSportIds.join(", "));
    console.log("----------------------------------------");

    const catalog = await fetchSportsAndCompetitions(apiUrl);

    const catalogInfo = await saveSportsAndCompetitions(
        catalog.sports,
        catalog.competitions,
        selectedSportIds
    );

    const selectionSnapshot = await db.ref("competition_selection").once("value");
    const rawSelections = selectionSnapshot.val() || {};

    const selectedCompetitionMap = {};

    catalog.competitions.forEach(function (competition) {
        const id = getCompetitionId(competition);

        if (id <= 0) {
            return;
        }

        const key = String(id);

        if (Object.prototype.hasOwnProperty.call(rawSelections, key)) {
            selectedCompetitionMap[key] = normalizeBoolean(rawSelections[key]);
        } else {
            const old = catalogInfo.oldCompetitions[key] || {};
            selectedCompetitionMap[key] = normalizeBoolean(old.selected);
        }
    });

    const selectedCompetitionCount = Object.keys(selectedCompetitionMap)
        .filter(function (key) {
            return selectedCompetitionMap[key];
        }).length;

    if (selectedCompetitionCount === 0) {
        throw new Error(
            "No competitions are selected. Refusing to modify matches."
        );
    }

    const dates = [
        getDateOffset(-1),
        getDateOffset(0),
        getDateOffset(1)
    ];

    const allowedDateMap = getAllowedDateMap();

    const allGames = {};
    const requestErrors = [];

    let expectedRequests = 0;
    let successfulRequests = 0;

    for (let s = 0; s < selectedSportIds.length; s++) {
        const sportId = selectedSportIds[s];

        for (let d = 0; d < dates.length; d++) {
            expectedRequests++;

            try {
                const games = await fetchGamesForDate(
                    apiUrl,
                    sportId,
                    dates[d]
                );

                successfulRequests++;

                games.forEach(function (game) {
                    const id = getFirstValue(
                        game.id,
                        game.gameId,
                        game.fixtureId
                    );

                    if (id === null) {
                        return;
                    }

                    allGames[cleanKey(id)] = game;
                });
            } catch (error) {
                const message =
                    "sport=" + sportId +
                    ", date=" + formatApiDate(dates[d]) +
                    ": " + error.message;

                requestErrors.push(message);
                console.error("Request failed:", message);
            }

            await sleep(REQUEST_DELAY);
        }
    }

    console.log("Expected requests:", expectedRequests);
    console.log("Successful requests:", successfulRequests);
    console.log("Unique games received:", Object.keys(allGames).length);

    // Do not delete old matches if even one request failed.
    const allRequestsSucceeded =
        successfulRequests === expectedRequests &&
        requestErrors.length === 0;

    if (successfulRequests === 0) {
        throw new Error("All requests failed. Existing matches preserved.");
    }

    const oldMatchesSnapshot = await db.ref("matches").once("value");
    const oldMatches = oldMatchesSnapshot.val() || {};

    const matchUpdates = {};

    let savedCount = 0;
    let skippedUnselected = 0;
    let skippedOutsideWindow = 0;
    let skippedNoDate = 0;

    Object.keys(allGames).forEach(function (key) {
        const game = allGames[key];

        const id = toText(
            getFirstValue(game.id, game.gameId, game.fixtureId),
            ""
        );

        if (!id) {
            return;
        }

        const firebaseKey = cleanKey(id);
        const oldMatch = oldMatches[firebaseKey] || {};

        const match = convertMatch(
            game,
            oldMatch,
            selectedCompetitionMap
        );

        if (!match) {
            return;
        }

        // Only selected competitions are saved.
        if (!match.competitionSelected) {
            skippedUnselected++;
            return;
        }

        // Require a valid kickoff timestamp for the retention policy.
        if (!match.matchTimeMillis || match.matchTimeMillis <= 0) {
            skippedNoDate++;
            return;
        }

        // Only yesterday, today, and tomorrow (India time).
        if (!isWithinAllowedDates(match.matchTimeMillis, allowedDateMap)) {
            skippedOutsideWindow++;
            return;
        }

        matchUpdates[firebaseKey] = match;
        savedCount++;
    });

    // If partial data came back, update only selected, valid matches.
    // Never run deletion on a partial sync.
    if (Object.keys(matchUpdates).length > 0) {
        await db.ref("matches").update(matchUpdates);
    }

    console.log("Selected matches prepared:", savedCount);
    console.log("Unselected matches skipped:", skippedUnselected);
    console.log("Outside date range skipped:", skippedOutsideWindow);
    console.log("Matches without valid date skipped:", skippedNoDate);

    // --------------------------------------------------
    // SAFE OLD MATCH CLEANUP
    // --------------------------------------------------
    // Delete only records that can be confidently identified as:
    // 1. 365Scores records, or older API-Football football records when
    //    switching providers.
    // 2. Outside the allowed India-date window.
    // 3. Not missing a valid timestamp.
    //
    // Do not delete unknown-provider records or records with unknown dates.

    let deletedCount = 0;

    if (allRequestsSucceeded && savedCount > 0) {
        const deleteUpdates = {};

        Object.keys(oldMatches).forEach(function (key) {
            // Do not delete a record just written in this run.
            if (Object.prototype.hasOwnProperty.call(matchUpdates, key)) {
                return;
            }

            const old = oldMatches[key] || {};

            const oldProvider = toText(
                old.apiProvider,
                ""
            ).toLowerCase();

            const oldSportId = toNumber(old.sportId, 0);

            const oldTimestamp = getTimestamp(
                getFirstValue(
                    old.matchTimeMillis,
                    old.timestamp
                )
            );

            // A match with no reliable date must be preserved.
            if (!oldTimestamp || oldTimestamp <= 0) {
                return;
            }

            const recognized365 = oldProvider === "365scores";
            const oldApiFootball = oldProvider === "apifootball" &&
                oldSportId === 1;

            if (!recognized365 && !oldApiFootball) {
                return;
            }

            if (!isWithinAllowedDates(oldTimestamp, allowedDateMap)) {
                deleteUpdates[key] = null;
            }
        });

        if (Object.keys(deleteUpdates).length > 0) {
            await db.ref("matches").update(deleteUpdates);
            deletedCount = Object.keys(deleteUpdates).length;
        }

        console.log("Old matches deleted:", deletedCount);
    } else {
        console.log(
            "Automatic deletion skipped: requests were incomplete " +
            "or no selected matches were prepared."
        );
    }

    // --------------------------------------------------
    // SYNC STATUS
    // --------------------------------------------------

    if (allRequestsSucceeded && savedCount > 0) {
        await db.ref("syncSettings").update({
            currentProvider: PROVIDER,
            lastSuccessfulSync: Date.now(),
            lastSyncStatus: "success",
            lastSyncMatchCount: savedCount,
            lastSyncDeletedCount: deletedCount,
            lastSyncSelectedLeagueCount: selectedCompetitionCount,
            lastSyncUnselectedLeagueCount: skippedUnselected,
            lastSyncDateWindow: "yesterday,today,tomorrow"
        });
    } else {
        await db.ref("syncSettings").update({
            lastSyncAttempt: Date.now(),
            lastSyncStatus: allRequestsSucceeded ? "empty" : "partial",
            lastSyncMatchCount: savedCount,
            lastSyncDeletedCount: 0,
            lastSyncErrors: requestErrors
        });
    }

    console.log("----------------------------------------");
    console.log("365Scores sync finished");
    console.log("Matches saved:", savedCount);
    console.log("Old matches deleted:", deletedCount);
    console.log("Selected competitions:", selectedCompetitionCount);
    console.log("Requests:", successfulRequests + "/" + expectedRequests);
    console.log("----------------------------------------");

    if (requestErrors.length > 0) {
        console.log("Some requests failed:");
        requestErrors.forEach(function (error) {
            console.log("- " + error);
        });
    }
}

// --------------------------------------------------
// RUN
// --------------------------------------------------

sync365Scores()
    .then(function () {
        console.log("365Scores script completed.");
    })
    .catch(function (error) {
        console.error("365Scores sync failed:", error);
        process.exitCode = 1;
    });
