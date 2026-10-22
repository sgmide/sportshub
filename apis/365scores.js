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
        return;
    }

    const serviceAccountText = process.env.FIREBASE_SERVICE_ACCOUNT;
    const databaseURL = process.env.FIREBASE_DATABASE_URL;

    if (!serviceAccountText) {
        throw new Error("FIREBASE_SERVICE_ACCOUNT secret missing");
    }

    if (!databaseURL) {
        throw new Error("FIREBASE_DATABASE_URL secret missing");
    }

    let serviceAccount;

    try {
        serviceAccount = JSON.parse(serviceAccountText);
    } catch (error) {
        throw new Error(
            "FIREBASE_SERVICE_ACCOUNT is not valid JSON"
        );
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

function toNumber(value, fallback) {
    const number = Number(value);

    if (!Number.isFinite(number)) {
        return fallback;
    }

    return number;
}

function toText(value, fallback) {
    if (value === undefined || value === null) {
        return fallback || "";
    }

    return String(value);
}

function isObject(value) {
    return value !== null &&
        typeof value === "object" &&
        !Array.isArray(value);
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

    if (
        typeof value === "string" &&
        value.toLowerCase() === "true"
    ) {
        return true;
    }

    return false;
}

function getTimestamp(value) {
    if (value === undefined || value === null || value === "") {
        return 0;
    }

    if (typeof value === "number") {
        return value < 1000000000000
            ? value * 1000
            : value;
    }

    const numeric = Number(value);

    if (Number.isFinite(numeric) && numeric > 0) {
        return numeric < 1000000000000
            ? numeric * 1000
            : numeric;
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

function getSelectedParser(settings) {
    return toText(
        settings.selected_parser,
        PROVIDER
    ).toLowerCase();
}

function getParserConfig(settings) {
    const selectedParser = getSelectedParser(settings);

    const parseSettings = isObject(settings.parse)
        ? settings.parse
        : {};

    const parserConfig = isObject(parseSettings[selectedParser])
        ? parseSettings[selectedParser]
        : {};

    return {
        selectedParser: selectedParser,
        apiParser: toText(
            parserConfig.api_parser,
            ""
        ).toLowerCase(),
        apiUrl: toText(
            parserConfig.api_url,
            DEFAULT_API_URL
        )
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
                    item.selected !== false &&
                    item.enabled !== false
                );
            } else if (item === true || item === 1) {
                addSport(index, true);
            } else if (typeof item === "number") {
                addSport(item, true);
            } else if (typeof item === "string") {
                if (item.trim() !== "") {
                    addSport(item, true);
                }
            }
        });
    } else if (isObject(selectedSports)) {
        Object.keys(selectedSports).forEach(function (key) {
            const item = selectedSports[key];

            if (isObject(item)) {
                addSport(
                    getFirstValue(item.id, item.sportId, key),
                    item.selected !== false &&
                    item.enabled !== false
                );
            } else {
                addSport(key, normalizeBoolean(item));
            }
        });
    }

    // Legacy setting support
    if (result.length === 0 && settings.selected_sport !== undefined) {
        const legacySport = settings.selected_sport;

        if (isObject(legacySport)) {
            Object.keys(legacySport).forEach(function (key) {
                addSport(key, normalizeBoolean(legacySport[key]));
            });
        } else {
            addSport(legacySport, true);
        }
    }

    return result;
}

// --------------------------------------------------
// DATE HELPERS
// --------------------------------------------------

function getDatePartsInTimeZone(date, timeZone) {
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: timeZone,
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
    const now = new Date();
    const parts = getDatePartsInTimeZone(now, TIME_ZONE);

    // Use UTC arithmetic to avoid local machine timezone differences.
    const date = new Date(Date.UTC(
        parts.year,
        parts.month - 1,
        parts.day + offset
    ));

    return {
        year: date.getUTCFullYear(),
        month: date.getUTCMonth() + 1,
        day: date.getUTCDate()
    };
}

function formatApiDate(dateParts) {
    const day = String(dateParts.day).padStart(2, "0");
    const month = String(dateParts.month).padStart(2, "0");
    const year = String(dateParts.year);

    return day + "/" + month + "/" + year;
}

function formatIsoDate(dateParts) {
    return String(dateParts.year) + "-" +
        String(dateParts.month).padStart(2, "0") + "-" +
        String(dateParts.day).padStart(2, "0");
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
            throw new Error(
                "HTTP " + response.status + " for " + url
            );
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

        if (
            value !== undefined &&
            value !== null &&
            value !== ""
        ) {
            url.searchParams.set(key, String(value));
        }
    });

    return url.toString();
}

// --------------------------------------------------
// FETCH SPORTS AND COMPETITIONS
// --------------------------------------------------

async function fetchSportsAndCompetitions(apiUrl) {
    const url = buildUrl(apiUrl, {
        lang: "en",
        timezoneName: TIME_ZONE
    });

    console.log("Fetching sports and competitions catalog...");

    const data = await requestJson(url);

    if (!data || !Array.isArray(data.sports)) {
        throw new Error(
            "365Scores response does not contain a valid sports array"
        );
    }

    if (!Array.isArray(data.competitions)) {
        throw new Error(
            "365Scores response does not contain a valid competitions array"
        );
    }

    return {
        sports: data.sports,
        competitions: data.competitions
    };
}

// --------------------------------------------------
// COMPETITION HELPERS
// --------------------------------------------------

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
        getFirstValue(
            sport.name,
            sport.shortName,
            sport.displayName
        ),
        "Unknown Sport"
    );
}

function getCompetitionLogo(competition) {
    const directLogo = getFirstValue(
        competition.logo,
        competition.image,
        competition.imageUrl,
        competition.logoUrl
    );

    if (directLogo) {
        return String(directLogo);
    }

    const imageId = getFirstValue(
        competition.imageId,
        competition.image_id
    );

    if (imageId) {
        return IMAGE_URL + "competitors/" + imageId;
    }

    return "";
}

function getSportLogo(sport) {
    return toText(
        getFirstValue(
            sport.logo,
            sport.image,
            sport.imageUrl
        ),
        ""
    );
}

// --------------------------------------------------
// PRESERVE COMPETITION SELECTION
// --------------------------------------------------

async function saveSportsAndCompetitions(
    sports,
    competitions,
    selectedSportIds
) {
    const sportUpdates = {};
    const competitionUpdates = {};

    const oldSportsSnapshot = await db.ref("sports").once("value");
    const oldCompetitionsSnapshot = await db.ref("competitions").once("value");
    const selectionSnapshot = await db.ref("competition_selection").once("value");

    const oldSports = oldSportsSnapshot.val() || {};
    const oldCompetitions = oldCompetitionsSnapshot.val() || {};
    const selections = selectionSnapshot.val() || {};

    const selectedSportMap = {};

    selectedSportIds.forEach(function (id) {
        selectedSportMap[String(id)] = true;
    });

    const validSportMap = {};

    sports.forEach(function (sport) {
        const sportId = toNumber(sport.id, 0);

        if (sportId <= 0) {
            return;
        }

        const key = String(sportId);
        const oldSport = oldSports[key] || {};

        validSportMap[key] = true;

        sportUpdates[key] = Object.assign({}, oldSport, {
            id: sportId,
            name: getSportName(sport),
            logo: getSportLogo(sport),
            selected: !!selectedSportMap[key],
            apiProvider: PROVIDER,
            updatedAt: Date.now()
        });
    });

    const validCompetitionMap = {};

    competitions.forEach(function (competition) {
        const competitionId = getCompetitionId(competition);

        if (competitionId <= 0) {
            return;
        }

        const key = String(competitionId);
        const sportId = getSportId(competition);
        const oldCompetition = oldCompetitions[key] || {};

        const selectionExists = Object.prototype.hasOwnProperty.call(
            selections,
            key
        );

        // Existing selection always wins.
        const selected = selectionExists
            ? normalizeBoolean(selections[key])
            : normalizeBoolean(oldCompetition.selected);

        validCompetitionMap[key] = true;

        const sport = sports.find(function (item) {
            return Number(item.id) === sportId;
        });

        competitionUpdates[key] = Object.assign({}, oldCompetition, {
            id: competitionId,
            competitionId: competitionId,
            sportId: sportId,
            sportName: sport ? getSportName(sport) : "",
            name: getCompetitionName(competition),
            logo: getCompetitionLogo(competition),
            selected: selected,
            apiProvider: PROVIDER,
            updatedAt: Date.now()
        });

        // Do not replace existing admin selection.
        // Initialize selection only when no entry exists.
        if (!selectionExists) {
            selectionSnapshot.ref.child(key).set(selected).catch(function (error) {
                console.error(
                    "Could not initialize selection for competition",
                    key,
                    error.message
                );
            });
        }
    });

    // Merge instead of replacing whole branches.
    if (Object.keys(sportUpdates).length > 0) {
        await db.ref("sports").update(sportUpdates);
    }

    if (Object.keys(competitionUpdates).length > 0) {
        await db.ref("competitions").update(competitionUpdates);
    }

    console.log(
        "Sports catalog updated:",
        Object.keys(sportUpdates).length
    );

    console.log(
        "Competitions catalog updated:",
        Object.keys(competitionUpdates).length
    );

    return {
        oldCompetitions: oldCompetitions,
        selections: selections,
        validCompetitionMap: validCompetitionMap,
        validSportMap: validSportMap
    };
}

// --------------------------------------------------
// MATCH STATUS
// --------------------------------------------------

function getMatchStatus(game) {
    const statusObject = isObject(game.status)
        ? game.status
        : {};

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

    if (
        /\bFT\b|\bAET\b|\bPEN\b|FINISHED|ENDED|FULL TIME/.test(combined)
    ) {
        return {
            status: "FT",
            shortStatus: "FT",
            live: false
        };
    }

    if (
        /\bCANC\b|CANCELLED|CANCELED/.test(combined)
    ) {
        return {
            status: "CANC",
            shortStatus: "CANC",
            live: false
        };
    }

    if (
        /\bPOSTP\b|POSTPONED/.test(combined)
    ) {
        return {
            status: "PPD",
            shortStatus: "PPD",
            live: false
        };
    }

    if (
        /\bABD\b|ABANDONED/.test(combined)
    ) {
        return {
            status: "ABD",
            shortStatus: "ABD",
            live: false
        };
    }

    if (
        /\bHT\b|HALF TIME|HALFTIME/.test(combined)
    ) {
        return {
            status: "HT",
            shortStatus: "HT",
            live: true
        };
    }

    if (
        /\b1H\b|FIRST HALF|1ST HALF/.test(combined)
    ) {
        return {
            status: "1H",
            shortStatus: "LIVE",
            live: true
        };
    }

    if (
        /\b2H\b|SECOND HALF|2ND HALF/.test(combined)
    ) {
        return {
            status: "2H",
            shortStatus: "LIVE",
            live: true
        };
    }

    if (
        /\bET\b|EXTRA TIME/.test(combined)
    ) {
        return {
            status: "ET",
            shortStatus: "LIVE",
            live: true
        };
    }

    if (
        /\bLIVE\b|\bIN PLAY\b|\bINPLAY\b|\bPLAYING\b|\bQ[1-4]\b|\bOT\b/.test(combined)
    ) {
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

    const timestamp = getTimestamp(
        getFirstValue(
            game.startTime,
            game.startDate,
            game.date,
            game.gameDate
        )
    );

    if (timestamp > 0 && timestamp < Date.now()) {
        // Avoid automatically calling every past kickoff a finished match.
        // The API status is authoritative when available.
        if (!statusText && !statusCode) {
            return {
                status: "UNKNOWN",
                shortStatus: "UNKNOWN",
                live: false
            };
        }
    }

    if (gameTime !== null) {
        const timeText = String(gameTime).toUpperCase();

        if (timeText.indexOf("'") !== -1 || /^\d+$/.test(timeText)) {
            return {
                status: timeText,
                shortStatus: "LIVE",
                live: true
            };
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
    const first = side === "home"
        ? getFirstValue(game.homeCompetitor, game.homeTeam, game.home)
        : getFirstValue(game.awayCompetitor, game.awayTeam, game.away);

    return isObject(first) ? first : {};
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

    const directLogo = getFirstValue(
        team.logo,
        team.image,
        team.imageUrl,
        team.logoUrl,
        team.imagePath
    );

    if (directLogo) {
        return String(directLogo);
    }

    const imageId = getFirstValue(
        team.imageId,
        team.image_id
    );

    if (imageId) {
        return IMAGE_URL + "competitors/" + imageId;
    }

    const oldLogo = side === "home"
        ? getFirstValue(oldMatch.homeLogo, oldMatch.homeTeamLogo)
        : getFirstValue(oldMatch.awayLogo, oldMatch.awayTeamLogo);

    return toText(oldLogo, "");
}

// --------------------------------------------------
// SCORE HELPERS
// --------------------------------------------------

function getScore(game, side) {
    const team = getTeamObject(game, side);

    const directScore = getFirstValue(
        team.score,
        team.currentScore,
        team.goals,
        side === "home" ? game.homeScore : game.awayScore,
        side === "home" ? game.homeCompetitorScore : game.awayCompetitorScore
    );

    if (directScore === null) {
        return 0;
    }

    const score = Number(directScore);

    return Number.isFinite(score) ? score : 0;
}

// --------------------------------------------------
// MATCH CONVERSION
// --------------------------------------------------

function convertMatch(game, oldMatch, selectedCompetitionMap) {
    const matchId = toText(
        getFirstValue(game.id, game.gameId, game.fixtureId),
        ""
    );

    if (!matchId) {
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

    const homeTeam = getTeamName(game, "home");
    const awayTeam = getTeamName(game, "away");

    const homeScore = getScore(game, "home");
    const awayScore = getScore(game, "away");

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

    const timestamp = matchTimeMillis > 0
        ? matchTimeMillis
        : Date.now();

    const competitionObject = isObject(game.competition)
        ? game.competition
        : {};

    const competitionName = toText(
        getFirstValue(
            competitionObject.name,
            competitionObject.shortName,
            game.competitionName,
            game.leagueName
        ),
        "Unknown Competition"
    );

    const competitionSelected = !!selectedCompetitionMap[
        String(competitionId)
    ];

    const elapsed = getFirstValue(
        game.gameTime,
        game.elapsed,
        game.minute,
        game.matchTime
    );

    const homeLogo = getTeamLogo(game, "home", oldMatch);
    const awayLogo = getTeamLogo(game, "away", oldMatch);

    const apiMatch = Object.assign({}, oldMatch, {
        gameId: matchId,
        apiFixtureId: matchId,
        apiProvider: PROVIDER,

        sportId: sportId,
        competitionId: competitionId,

        competition: competitionName,
        league: competitionName,
        competitionName: competitionName,

        home: homeTeam,
        away: awayTeam,
        homeTeam: homeTeam,
        awayTeam: awayTeam,

        homeTeamId: getTeamId(game, "home"),
        awayTeamId: getTeamId(game, "away"),

        homeScore: homeScore,
        awayScore: awayScore,

        homeLogo: homeLogo,
        awayLogo: awayLogo,
        homeTeamLogo: homeLogo,
        awayTeamLogo: awayLogo,

        status: statusInfo.status,
        shortStatus: statusInfo.shortStatus,
        isLive: statusInfo.live,

        elapsed: elapsed === null ? "" : String(elapsed),

        timestamp: timestamp,
        matchTimeMillis: matchTimeMillis,

        date: matchTimeMillis > 0
            ? new Date(matchTimeMillis).toISOString()
            : "",

        competitionSelected: competitionSelected,

        updatedAt: Date.now()
    });

    // Preserve admin-managed values if the API doesn't supply them.
    apiMatch.streamUrl = toText(
        getFirstValue(game.streamUrl, oldMatch.streamUrl),
        ""
    );

    apiMatch.goalEvents = getFirstValue(
        game.goalEvents,
        oldMatch.goalEvents,
        []
    );

    apiMatch.adminNotes = toText(oldMatch.adminNotes, "");

    apiMatch.stadium = toText(
        getFirstValue(
            game.stadium,
            game.venue,
            oldMatch.stadium
        ),
        ""
    );

    apiMatch.channels = getFirstValue(
        oldMatch.channels,
        game.channels,
        []
    );

    return apiMatch;
}

// --------------------------------------------------
// FETCH GAMES FOR ONE SPORT AND ONE DATE
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
        "Fetching 365Scores games:",
        "sport=" + sportId,
        "date=" + formatApiDate(dateParts)
    );

    const data = await requestJson(url);

    if (!data || !Array.isArray(data.games)) {
        throw new Error(
            "365Scores response does not contain a valid games array " +
            "(sport=" + sportId +
            ", date=" + formatApiDate(dateParts) + ")"
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
        parserConfig.apiParser !== PROVIDER
    ) {
        console.log(
            "365Scores sync skipped. Selected parser:",
            parserConfig.selectedParser,
            "API parser:",
            parserConfig.apiParser
        );

        return;
    }

    const selectedSportIds = normalizeSportIds(settings);

    if (selectedSportIds.length === 0) {
        console.log(
            "No selected sports found in settings/selected_sports."
        );

        return;
    }

    const apiUrl = parserConfig.apiUrl || DEFAULT_API_URL;

    console.log("----------------------------------------");
    console.log("Sports Hub 365Scores Sync");
    console.log("Selected sports:", selectedSportIds.join(", "));
    console.log("API URL:", apiUrl);
    console.log("----------------------------------------");

    // Fetch catalog first. If this fails, do not modify matches.
    const catalog = await fetchSportsAndCompetitions(apiUrl);

    const catalogInfo = await saveSportsAndCompetitions(
        catalog.sports,
        catalog.competitions,
        selectedSportIds
    );

    const selectedSportMap = {};

    selectedSportIds.forEach(function (id) {
        selectedSportMap[String(id)] = true;
    });

    // Use the existing Admin App selection as the source of truth.
    const selectionSnapshot = await db.ref(
        "competition_selection"
    ).once("value");

    const rawSelections = selectionSnapshot.val() || {};

    const selectedCompetitionMap = {};

    catalog.competitions.forEach(function (competition) {
        const competitionId = getCompetitionId(competition);

        if (competitionId <= 0) {
            return;
        }

        const key = String(competitionId);

        if (Object.prototype.hasOwnProperty.call(rawSelections, key)) {
            selectedCompetitionMap[key] = normalizeBoolean(
                rawSelections[key]
            );
        } else {
            const oldCompetition = catalogInfo.oldCompetitions[key] || {};

            selectedCompetitionMap[key] = normalizeBoolean(
                oldCompetition.selected
            );
        }
    });

    const dates = [
        getDateOffset(-1),
        getDateOffset(0),
        getDateOffset(1)
    ];

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

                    const key = cleanKey(id);

                    // Deduplicate the same game returned by multiple requests.
                    allGames[key] = game;
                });
            } catch (error) {
                const message =
                    "sport=" + sportId +
                    ", date=" + formatApiDate(dates[d]) +
                    ": " + error.message;

                requestErrors.push(message);

                console.error("365Scores request failed:", message);
            }

            await sleep(REQUEST_DELAY);
        }
    }

    console.log("Expected requests:", expectedRequests);
    console.log("Successful requests:", successfulRequests);
    console.log("Failed requests:", requestErrors.length);
    console.log("Unique games received:", Object.keys(allGames).length);

    if (successfulRequests === 0) {
        throw new Error(
            "All 365Scores game requests failed. Existing matches were not changed."
        );
    }

    const oldMatchesSnapshot = await db.ref("matches").once("value");
    const oldMatches = oldMatchesSnapshot.val() || {};

    const matchUpdates = {};

    let totalPrepared = 0;
    let selectedLeagueMatches = 0;
    let unselectedLeagueMatches = 0;
    let footballMatchesPrepared = 0;

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

        // IMPORTANT:
        // Save ALL games returned by the selected sports.
        // Do not skip unselected competitions here.
        matchUpdates[firebaseKey] = match;

        totalPrepared++;

        if (match.competitionSelected) {
            selectedLeagueMatches++;
        } else {
            unselectedLeagueMatches++;
        }

        if (Number(match.sportId) === 1) {
            footballMatchesPrepared++;
        }
    });

    if (totalPrepared === 0) {
        console.log(
            "No games returned. Existing matches will be preserved."
        );
    } else {
        // Write matches only after processing all successful responses.
        // Unselected competitions are also saved.
        await db.ref("matches").update(matchUpdates);
    }

    // --------------------------------------------------
    // PROVIDER CLEANUP
    // --------------------------------------------------
    // Delete old API-Football football matches only if:
    // 1. Provider was previously API-Football.
    // 2. All expected requests succeeded.
    // 3. At least one 365Scores football match was prepared.
    // This avoids deleting data on partial failures or empty results.

    const syncSettingsSnapshot = await db.ref(
        "syncSettings"
    ).once("value");

    const syncSettings = syncSettingsSnapshot.val() || {};

    const previousProvider = toText(
        syncSettings.currentProvider,
        ""
    ).toLowerCase();

    const allRequestsSucceeded =
        successfulRequests === expectedRequests &&
        requestErrors.length === 0;

    if (
        previousProvider === "apifootball" &&
        allRequestsSucceeded &&
        footballMatchesPrepared > 0
    ) {
        const cleanupUpdates = {};

        Object.keys(oldMatches).forEach(function (key) {
            const oldMatch = oldMatches[key] || {};

            const oldProvider = toText(
                oldMatch.apiProvider,
                ""
            ).toLowerCase();

            const oldSportId = toNumber(oldMatch.sportId, 0);

            if (
                oldProvider === "apifootball" &&
                oldSportId === 1
            ) {
                cleanupUpdates[key] = null;
            }
        });

        if (Object.keys(cleanupUpdates).length > 0) {
            await db.ref("matches").update(cleanupUpdates);

            console.log(
                "Removed old API-Football football matches:",
                Object.keys(cleanupUpdates).length
            );
        }
    } else if (previousProvider === "apifootball") {
        console.log(
            "Provider cleanup skipped: requests were incomplete or " +
            "no 365Scores football matches were received."
        );
    }

    // Update provider marker only when all requests succeeded and games exist.
    if (
        allRequestsSucceeded &&
        totalPrepared > 0
    ) {
        await db.ref("syncSettings").update({
            currentProvider: PROVIDER,
            lastSuccessfulSync: Date.now(),
            lastSyncStatus: "success",
            lastSyncMatchCount: totalPrepared,
            lastSyncSelectedLeagueCount: selectedLeagueMatches,
            lastSyncUnselectedLeagueCount: unselectedLeagueMatches
        });
    } else {
        await db.ref("syncSettings").update({
            lastSyncAttempt: Date.now(),
            lastSyncStatus: "partial",
            lastSyncMatchCount: totalPrepared,
            lastSyncErrors: requestErrors
        });
    }

    console.log("----------------------------------------");
    console.log("365Scores sync finished");
    console.log("Matches saved:", totalPrepared);
    console.log("Selected league matches:", selectedLeagueMatches);
    console.log("Unselected league matches:", unselectedLeagueMatches);
    console.log("Requests successful:", successfulRequests + "/" + expectedRequests);
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
