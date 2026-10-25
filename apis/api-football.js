"use strict";

const axios = require("axios");

const BASE_URL = "https://v3.football.api-sports.io";

function getApiKey(settings) {
    settings = settings || {};

    return process.env.API_FOOTBALL_KEY ||
        process.env.APISPORTS_KEY ||
        settings.apiFootballKey ||
        "";
}

function getBaseUrl(parserSettings) {
    parserSettings = parserSettings || {};

    let url = String(
        parserSettings.api_url ||
        "https://v3.football.api-sports.io"
    ).replace(/\/+$/, "");

    url = url.replace(/\/fixtures$/i, "");
    url = url.replace(/\/leagues$/i, "");

    return url || BASE_URL;
}

async function apiGet(endpoint, params, settings, parserSettings) {
    const apiKey = getApiKey(settings);

    if (!apiKey) {
        throw new Error("API_FOOTBALL_KEY secret is missing");
    }

    const url = getBaseUrl(parserSettings) + endpoint;

    const response = await axios.get(url, {
        timeout: 30000,
        params: params || {},
        headers: {
            "x-apisports-key": apiKey,
            "Accept": "application/json"
        }
    });

    const data = response.data || {};

    if (data.errors && Object.keys(data.errors).length > 0) {
        throw new Error(
            "API-Football error: " + JSON.stringify(data.errors)
        );
    }

    if (!Array.isArray(data.response)) {
        throw new Error("Unexpected API-Football response");
    }

    return data.response;
}

function toMillis(value) {
    if (!value) return 0;

    const parsed = Date.parse(value);

    return Number.isFinite(parsed) ? parsed : 0;
}

function numberOrZero(value) {
    if (value == null || value === "") return 0;

    const number = Number(value);

    return Number.isFinite(number) ? number : 0;
}

function normalize(fixture) {
    if (!fixture || !fixture.fixture || fixture.fixture.id == null) {
        return null;
    }

    const info = fixture.fixture;
    const league = fixture.league || {};
    const teams = fixture.teams || {};
    const goals = fixture.goals || {};
    const scores = fixture.score || {};
    const home = teams.home || {};
    const away = teams.away || {};
    const statusInfo = info.status || {};

    const status = statusInfo.short || "NS";
    const elapsed = statusInfo.elapsed;

    const liveStatuses = ["1H", "2H", "HT", "ET", "BT", "P", "LIVE"];

    const displayStatus =
        elapsed != null && liveStatuses.indexOf(status) !== -1
            ? String(elapsed) + "'"
            : status;

    const halftime = scores.halftime || {};
    const fulltime = scores.fulltime || {};
    const extratime = scores.extratime || {};
    const penalty = scores.penalty || {};
    const venue = info.venue || {};
    const timestamp = toMillis(info.date);

    return {
        gameId: Number(info.id),
        apiFixtureId: Number(info.id),
        apiProvider: "api-football",
        sportId: 1,

        competitionId: numberOrZero(league.id),
        competitionName: league.name || "",
        country: league.country || "",
        competitionLogo: league.logo || "",
        competitionFlag: league.flag || "",
        season: numberOrZero(league.season),
        round: league.round || "",

        homeCompetitorId: numberOrZero(home.id),
        awayCompetitorId: numberOrZero(away.id),
        homeTeam: home.name || "Home",
        awayTeam: away.name || "Away",
        homeLogo: home.logo || "",
        awayLogo: away.logo || "",

        homeScore: goals.home,
        awayScore: goals.away,
        halftimeHomeScore: halftime.home,
        halftimeAwayScore: halftime.away,
        fulltimeHomeScore: fulltime.home,
        fulltimeAwayScore: fulltime.away,
        extratimeHomeScore: extratime.home,
        extratimeAwayScore: extratime.away,
        penaltyHomeScore: penalty.home,
        penaltyAwayScore: penalty.away,

        goalEvents: Array.isArray(fixture.goalEvents)
            ? fixture.goalEvents
            : [],

        timestamp: timestamp,
        matchTimeMillis: timestamp,
        status: displayStatus,
        shortStatus: status,

        venue: venue.name || "",
        stadium: venue.name || "",
        venueCity: venue.city || "",

        streamUrl: ""
    };
}

async function fetchCatalog(options) {
    options = options || {};

    const settings = options.settings || {};
    const parserSettings = options.parserSettings || {};
    const currentYear = new Date().getFullYear();

    const response = await apiGet(
        "/leagues",
        { season: currentYear },
        settings,
        parserSettings
    );

    const competitions = response.map(function (item) {
        const league = item.league || {};
        const country = item.country || {};

        return {
            id: league.id,
            name: league.name || "",
            type: league.type || "",
            logo: league.logo || "",
            country: country.name || "",
            season: currentYear,
            sportId: 1
        };
    }).filter(function (item) {
        return item.id != null && item.name;
    });

    return {
        sports: [
            {
                id: 1,
                name: "Football",
                nameForURL: "football"
            }
        ],
        competitions: competitions
    };
}

async function fetchMatches(options) {
    options = options || {};

    const date = options.date;
    const settings = options.settings || {};
    const parserSettings = options.parserSettings || {};

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new Error("Invalid date. Expected YYYY-MM-DD");
    }

    const response = await apiGet(
        "/fixtures",
        {
            date: date,
            timezone: options.timeZone || "Asia/Kolkata"
        },
        settings,
        parserSettings
    );

    const unique = Object.create(null);

    response.forEach(function (fixture) {
        const match = normalize(fixture);

        if (match) {
            unique[String(match.gameId)] = match;
        }
    });

    const matches = Object.keys(unique).map(function (id) {
        return unique[id];
    });

    console.log(
        "API-Football " + date + ": " + matches.length + " fixtures"
    );

    return matches;
}

module.exports = {
    fetchCatalog: fetchCatalog,
    fetchMatches: fetchMatches
};
