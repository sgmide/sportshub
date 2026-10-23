"use strict";

const axios = require("axios");

function getApiKey(settings) {
    return (
        process.env.API_FOOTBALL_KEY ||
        process.env.APISPORTS_KEY ||
        settings.apiFootballKey ||
        ""
    );
}

function getFixturesUrl(parserSettings) {
    const configured =
        parserSettings.game_api_url ||
        parserSettings.api_url ||
        "https://v3.football.api-sports.io/fixtures";

    const url = configured.replace(/\/+$/, "");

    if (/\/fixtures$/i.test(url)) {
        return url;
    }

    return url + "/fixtures";
}

function toMillis(value) {
    if (!value) return 0;

    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function normalize(fixture) {
    const id = fixture.fixture && fixture.fixture.id;

    if (id == null) return null;

    const fixtureInfo = fixture.fixture || {};
    const league = fixture.league || {};
    const teams = fixture.teams || {};
    const goals = fixture.goals || {};
    const score = fixture.score || {};
    const home = teams.home || {};
    const away = teams.away || {};
    const statusInfo = fixtureInfo.status || {};

    const status = statusInfo.short || "NS";
    const elapsed = statusInfo.elapsed;

    const displayStatus =
        elapsed != null &&
        (
            status === "1H" ||
            status === "2H" ||
            status === "ET" ||
            status === "LIVE"
        )
            ? String(elapsed) + "'"
            : status;

    const timestamp = toMillis(fixtureInfo.date);

    return {
        gameId: Number(id),
        apiFixtureId: Number(id),
        apiProvider: "api-football",

        competitionId: Number(league.id || 0),
        competitionName: league.name || "",
        sportId: 1,

        homeCompetitorId: Number(home.id || 0),
        awayCompetitorId: Number(away.id || 0),

        homeTeam: home.name || "Home",
        awayTeam: away.name || "Away",

        homeLogo: home.logo || "",
        awayLogo: away.logo || "",

        homeScore: goals.home == null ? 0 : Number(goals.home),
        awayScore: goals.away == null ? 0 : Number(goals.away),

        halftimeHomeScore:
            score.halftime && score.halftime.home != null
                ? Number(score.halftime.home)
                : 0,

        halftimeAwayScore:
            score.halftime && score.halftime.away != null
                ? Number(score.halftime.away)
                : 0,

        goalEvents: [],

        timestamp: timestamp,
        matchTimeMillis: timestamp,

        status: displayStatus,
        shortStatus: status,

        round: league.round || "",
        season: league.season || 0,
        venue: fixtureInfo.venue
            ? fixtureInfo.venue.name || ""
            : "",

        streamUrl: ""
    };
}

async function fetchMatches(options) {
    const date = options.date;
    const settings = options.settings || {};
    const parserSettings = options.parserSettings || {};

    const apiKey = getApiKey(settings);

    if (!apiKey) {
        throw new Error(
            "API_FOOTBALL_KEY secret is missing"
        );
    }

    const url = getFixturesUrl(parserSettings);

    const response = await axios.get(url, {
        timeout: 30000,
        params: {
            date: date,
            timezone: "Asia/Kolkata"
        },
        headers: {
            "x-apisports-key": apiKey,
            "Accept": "application/json"
        }
    });

    const data = response.data || {};

    if (data.errors && Object.keys(data.errors).length) {
        throw new Error(
            "API-Football error: " +
            JSON.stringify(data.errors)
        );
    }

    if (!Array.isArray(data.response)) {
        throw new Error(
            "Unexpected API-Football response"
        );
    }

    return data.response.map(normalize).filter(function (match) {
        return match != null;
    });
}

module.exports = {
    fetchMatches: fetchMatches
};
