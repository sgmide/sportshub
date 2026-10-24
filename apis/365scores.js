
"use strict";

const axios = require("axios");

const BASE_URL = "https://webws.365scores.com/web/games/";
const CATALOG_URL = "https://webws.365scores.com/web/sports/";
const GAME_URL = "https://webws.365scores.com/web/game/";

const TIME_ZONE = "Asia/Kolkata";
const PROVIDER_NAME = "365scores";

/*
 * Common API parameters
 */
function getParams(extra) {
    return Object.assign({
        appTypeId: 5,
        langId: 1,
        timezoneName: TIME_ZONE,
        userCountryId: 113,
        withTop: true,
        onlyMajorGames: false
    }, extra || {});
}

/*
 * Safe number conversion
 */
function toNumber(value, fallback) {
    if (
        value === undefined ||
        value === null ||
        value === "" ||
        typeof value === "object"
    ) {
        return fallback === undefined ? 0 : fallback;
    }

    const result = Number(value);

    return Number.isFinite(result)
        ? result
        : (fallback === undefined ? 0 : fallback);
}

/*
 * Safe string conversion
 */
function toStringValue(value) {
    if (value === undefined || value === null) {
        return "";
    }

    if (typeof value === "object") {
        return "";
    }

    return String(value).trim();
}

/*
 * Convert a date to a valid Date object.
 */
function parseDate(value) {
    if (!value) {
        return null;
    }

    const parsed = value instanceof Date
        ? value
        : new Date(value);

    return Number.isFinite(parsed.getTime())
        ? parsed
        : null;
}

/*
 * Format date using India time zone.
 * Output: DD-MM-YYYY
 */
function getFirebaseDate(value) {
    const date = parseDate(value);

    if (!date) {
        return "";
    }

    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: TIME_ZONE,
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
    }).formatToParts(date);

    const values = {};

    parts.forEach(function (part) {
        values[part.type] = part.value;
    });

    return values.day + "-" +
        values.month + "-" +
        values.year;
}

/*
 * Format time using India time zone.
 */
function getFirebaseTime(value) {
    const date = parseDate(value);

    if (!date) {
        return "";
    }

    return new Intl.DateTimeFormat("en-US", {
        timeZone: TIME_ZONE,
        hour: "2-digit",
        minute: "2-digit",
        hour12: true
    }).format(date);
}

/*
 * Unix timestamp in milliseconds.
 */
function getTimestamp(value) {
    const date = parseDate(value);

    return date ? date.getTime() : 0;
}

/*
 * Extract game start time.
 */
function getStartTime(game) {
    return game.startTime ||
        game.startDate ||
        game.date ||
        game.start_time ||
        "";
}

/*
 * Extract a competitor safely.
 */
function getCompetitor(game, side) {
    const key = side === "home"
        ? "homeCompetitor"
        : "awayCompetitor";

    const competitor = game[key];

    return competitor && typeof competitor === "object"
        ? competitor
        : {};
}

/*
 * Competitor logo.
 */
function getCompetitorLogo(competitor) {
    if (!competitor || !competitor.id) {
        return "";
    }

    return "https://imagecache.365scores.com/image/upload/" +
        "f_auto,w_120,h_120,c_limit,q_auto:eco/v2/competitors/" +
        encodeURIComponent(String(competitor.id));
}

/*
 * Score formatter.
 * Missing scores remain empty; they are not converted to zero.
 */
function getScore(home, away) {
    if (
        home.score === undefined ||
        home.score === null ||
        away.score === undefined ||
        away.score === null
    ) {
        return "";
    }

    return String(home.score) + " - " +
        String(away.score);
}

/*
 * Normalize goal events.
 */
function normalizeGoalEvents(events) {
    if (!Array.isArray(events)) {
        return [];
    }

    return events.map(function (event) {
        event = event || {};

        return {
            competitorId: toNumber(event.competitorId),
            gameTime: toStringValue(event.gameTime),
            playerId: toNumber(event.playerId),
            playerName: toStringValue(event.playerName),
            type: toStringValue(event.type)
        };
    });
}

/*
 * Extract competition ID.
 */
function getCompetitionId(game) {
    const competition = game.competition || {};
    const league = game.league || {};

    return toNumber(
        game.competitionId ||
        game.competition_id ||
        game.competitionID ||
        game.leagueId ||
        game.league_id ||
        competition.id ||
        league.id
    );
}

/*
 * Extract competition name.
 */
function getCompetitionName(game) {
    const competition = game.competition || {};
    const league = game.league || {};

    return toStringValue(
        game.competitionDisplayName ||
        game.competitionName ||
        game.leagueName ||
        game.league_name ||
        competition.name ||
        league.name ||
        (typeof game.league === "string"
            ? game.league
            : "")
    );
}

/*
 * Extract sport ID.
 */
function getSportId(game) {
    const sport = game.sport;

    return toNumber(
        game.sportId ||
        game.sport_id ||
        (sport && typeof sport === "object"
            ? sport.id
            : sport)
    );
}

/*
 * Extract status text without turning objects into strings.
 */
function getStatusText(game) {
    const status = game.status;

    if (typeof status === "string" ||
        typeof status === "number") {
        return toStringValue(
            game.statusText ||
            game.shortStatusText ||
            status
        );
    }

    return toStringValue(
        game.statusText ||
        game.shortStatusText ||
        (status && (
            status.shortName ||
            status.name ||
            status.text
        )) ||
        ""
    );
}

/*
 * Normalize one game to the Sports Hub Firebase structure.
 */
function normalizeMatch(game) {
    game = game || {};

    const home = getCompetitor(game, "home");
    const away = getCompetitor(game, "away");

    const gameId = toStringValue(
        game.id ||
        game.gameId ||
        game.fixtureId
    );

    const startTime = getStartTime(game);
    const timestamp = getTimestamp(startTime);

    const competitionId = getCompetitionId(game);
    const competitionName = getCompetitionName(game);
    const sportId = getSportId(game);
    const status = getStatusText(game);

    return {
        gameId: gameId,
        apiFixtureId: gameId,
        apiProvider: PROVIDER_NAME,

        sportId: sportId,
        competitionId: competitionId,
        competitionName: competitionName,

        home: toStringValue(home.name),
        away: toStringValue(away.name),

        homeCompetitorId: toNumber(home.id),
        awayCompetitorId: toNumber(away.id),

        homeLogo: getCompetitorLogo(home),
        awayLogo: getCompetitorLogo(away),

        league: competitionName,

        date: getFirebaseDate(startTime),
        time: getFirebaseTime(startTime),

        timestamp: timestamp,
        matchTimeMillis: timestamp,

        score: getScore(home, away),

        homeScore: home.score === undefined
            ? null
            : home.score,

        awayScore: away.score === undefined
            ? null
            : away.score,

        status: status,

        shortStatus: toStringValue(
            game.shortStatusText ||
            game.statusShort ||
            status
        ),

        round: toStringValue(game.roundName),
        stage: toStringValue(game.stageName),
        seasonNum: toNumber(game.seasonNum),

        stadium: toStringValue(
            game.venueName ||
            game.stadiumName ||
            ""
        ),

        goalEvents: normalizeGoalEvents(game.goalEvents),

        /*
         * index.js must preserve the old streamUrl on same-provider
         * updates when this value is empty.
         */
        streamUrl: ""
    };
}

/*
 * Normalize competition catalog item.
 */
function normalizeCompetition(item) {
    item = item || {};

    const competitionId = toNumber(
        item.id ||
        item.competitionId ||
        item.competition_id ||
        item.leagueId ||
        item.league_id
    );

    return {
        id: competitionId,
        competitionId: competitionId,

        sportId: toNumber(
            item.sportId ||
            item.sport_id ||
            (item.sport && item.sport.id)
        ),

        countryId: toNumber(
            item.countryId ||
            item.country_id
        ),

        name: toStringValue(
            item.name ||
            item.competitionDisplayName ||
            item.longName ||
            item.competitionName ||
            ""
        ),

        nameForURL: toStringValue(item.nameForURL),

        mainCompetitionId: toNumber(
            item.mainCompetitionId
        ),

        hideOnCatalog: item.hideOnCatalog === true,
        hideOnSearch: item.hideOnSearch === true,
        isInternational: item.isInternational === true,
        hasActiveGames: item.hasActiveGames === true,

        totalGames: toNumber(item.totalGames),
        liveGames: toNumber(item.liveGames),

        currentSeasonNum: toNumber(
            item.currentSeasonNum
        ),

        currentStageNum: toNumber(
            item.currentStageNum
        ),

        provider: PROVIDER_NAME
    };
}

/*
 * Normalize sport catalog item.
 */
function normalizeSport(item) {
    item = item || {};

    const sportId = toNumber(
        item.id ||
        item.sportId ||
        item.sport_id
    );

    return {
        id: sportId,
        sportId: sportId,

        name: toStringValue(
            item.name ||
            item.sportName ||
            ""
        ),

        nameForURL: toStringValue(item.nameForURL),

        totalGames: toNumber(item.totalGames),
        liveGames: toNumber(item.liveGames),

        provider: PROVIDER_NAME
    };
}

/*
 * HTTP GET helper.
 */
async function request(url, params) {
    const response = await axios.get(url, {
        params: getParams(params),
        timeout: 30000,
        headers: {
            Accept: "application/json",
            "User-Agent": "Mozilla/5.0"
        }
    });

    return response.data || {};
}

/*
 * Fetch sports and competition catalog.
 */
async function fetchCatalog(options) {
    options = options || {};

    const data = await request(CATALOG_URL, {});

    const sports = Array.isArray(data.sports)
        ? data.sports.map(normalizeSport)
        : [];

    const competitions = Array.isArray(data.competitions)
        ? data.competitions.map(normalizeCompetition)
        : [];

    console.log("365Scores catalog sports:", sports.length);
    console.log(
        "365Scores catalog competitions:",
        competitions.length
    );

    return {
        sports: sports,
        countries: Array.isArray(data.countries)
            ? data.countries
            : [],
        competitions: competitions
    };
}

/*
 * Fetch matches for selected sports and date range.
 *
 * Expected dates: DD/MM/YYYY.
 */
async function fetchMatches(options) {
    options = options || {};

    const sportIds = Array.isArray(options.sportIds)
        ? options.sportIds
        : [];

    const startDate = options.startDate;
    const endDate = options.endDate;

    if (sportIds.length === 0) {
        throw new Error(
            "No sports selected for 365Scores."
        );
    }

    if (!startDate || !endDate) {
        throw new Error(
            "startDate and endDate are required."
        );
    }

    const allMatches = [];
    const seen = {};

    for (let i = 0; i < sportIds.length; i++) {
        const sportId = toNumber(sportIds[i]);

        console.log(
            "Fetching 365Scores games for sport:",
            sportId
        );

        const data = await request(BASE_URL, {
            sports: sportId,
            startDate: startDate,
            endDate: endDate,
            showOdds: true
        });

        const games = Array.isArray(data.games)
            ? data.games
            : [];

        console.log(
            "Sport",
            sportId,
            "returned",
            games.length,
            "games"
        );

        if (games.length > 0) {
            console.log(
                "Sample game fields:",
                Object.keys(games[0]).join(", ")
            );
        }

        games.forEach(function (game) {
            const match = normalizeMatch(game);

            if (!match.gameId || seen[match.gameId]) {
                return;
            }

            seen[match.gameId] = true;
            allMatches.push(match);
        });
    }

    return allMatches;
}

/*
 * Fetch raw details for a single game.
 */
async function fetchGameDetails(gameId) {
    if (
        gameId === undefined ||
        gameId === null ||
        String(gameId).trim() === ""
    ) {
        throw new Error("gameId is required.");
    }

    return await request(GAME_URL, {
        gameId: String(gameId)
    });
}

/*
 * Module exports.
 */
module.exports = {
    providerName: PROVIDER_NAME,
    fetchCatalog: fetchCatalog,
    fetchMatches: fetchMatches,
    fetchGameDetails: fetchGameDetails,
    normalizeMatch: normalizeMatch,
    normalizeSport: normalizeSport,
    normalizeCompetition: normalizeCompetition
};
