
"use strict";

const axios = require("axios");

function getApiUrl(parserSettings, date) {
    parserSettings = parserSettings || {};

    const baseUrl = String(
        parserSettings.api_url ||
        "https://king.totalsportslive.co.zw/api/livescore?date="
    ).trim();

    if (baseUrl.indexOf("{date}") !== -1) {
        return baseUrl.replace(
            /\{date\}/g,
            encodeURIComponent(date)
        );
    }

    if (/[?&]date=$/i.test(baseUrl)) {
        return baseUrl + encodeURIComponent(date);
    }

    const separator = baseUrl.indexOf("?") === -1
        ? "?"
        : "&";

    return baseUrl + separator +
        "date=" + encodeURIComponent(date);
}

function firstValue(object, keys, fallback) {
    if (!object || typeof object !== "object") {
        return fallback;
    }

    for (let i = 0; i < keys.length; i++) {
        const value = object[keys[i]];

        if (value !== undefined && value !== null) {
            return value;
        }
    }

    return fallback;
}

function toMillis(value) {
    if (value == null || value === "") return 0;

    if (typeof value === "number") {
        return value < 1000000000000
            ? value * 1000
            : value;
    }

    const result = Date.parse(String(value));

    return Number.isFinite(result) ? result : 0;
}

function numberOrZero(value) {
    if (value == null || value === "") return 0;

    const result = Number(value);

    return Number.isFinite(result) ? result : 0;
}

function getStatus(raw) {
    const value = String(firstValue(raw, [
        "shortStatus",
        "short_status",
        "statusShort",
        "status",
        "matchStatus",
        "match_status",
        "state"
    ], "NS")).trim();

    const upper = value.toUpperCase();

    if (
        upper === "FINISHED" ||
        upper === "FULL TIME"
    ) {
        return { status: "FT", shortStatus: "FT" };
    }

    if (upper === "HALF TIME") {
        return { status: "HT", shortStatus: "HT" };
    }

    if (
        upper === "IN PLAY" ||
        upper === "INPLAY"
    ) {
        return { status: "LIVE", shortStatus: "LIVE" };
    }

    if (
        upper === "NOT STARTED" ||
        upper === "UPCOMING" ||
        upper === "SCHEDULED"
    ) {
        return { status: "NS", shortStatus: "NS" };
    }

    if (
        upper === "POSTPONED"
    ) {
        return { status: "PST", shortStatus: "PST" };
    }

    if (
        upper === "CANCELLED" ||
        upper === "CANCELED"
    ) {
        return { status: "CANC", shortStatus: "CANC" };
    }

    if (/^\d{1,3}'$/.test(value)) {
        return { status: value, shortStatus: "LIVE" };
    }

    return {
        status: value || "NS",
        shortStatus: upper || "NS"
    };
}

function normalize(raw) {
    if (!raw || typeof raw !== "object") {
        return null;
    }

    const id = firstValue(raw, [
        "gameId",
        "game_id",
        "fixtureId",
        "fixture_id",
        "matchId",
        "match_id",
        "eventId",
        "event_id",
        "id"
    ], null);

    const home = firstValue(raw, [
        "homeTeam",
        "home_team",
        "homeName",
        "home_name",
        "localteam",
        "home",
        "team1"
    ], "");

    const away = firstValue(raw, [
        "awayTeam",
        "away_team",
        "awayName",
        "away_name",
        "visitorteam",
        "away",
        "team2"
    ], "");

    const homeName = typeof home === "object"
        ? firstValue(home, ["name", "title", "teamName"], "")
        : home;

    const awayName = typeof away === "object"
        ? firstValue(away, ["name", "title", "teamName"], "")
        : away;

    if (
        id == null ||
        String(id) === "" ||
        !homeName ||
        !awayName
    ) {
        return null;
    }

    const competition = firstValue(raw, [
        "competition",
        "league",
        "tournament"
    ], {});

    const competitionId = firstValue(raw, [
        "competitionId",
        "competition_id",
        "leagueId",
        "league_id",
        "tournamentId"
    ], typeof competition === "object"
        ? firstValue(competition, ["id", "leagueId"], 0)
        : 0);

    const competitionName = firstValue(raw, [
        "competitionName",
        "competition_name",
        "leagueName",
        "league_name",
        "tournamentName"
    ], typeof competition === "object"
        ? firstValue(competition, ["name", "title"], "")
        : competition);

    const homeId = firstValue(raw, [
        "homeCompetitorId",
        "homeTeamId",
        "home_team_id",
        "home_id"
    ], typeof home === "object"
        ? firstValue(home, ["id", "teamId"], 0)
        : 0);

    const awayId = firstValue(raw, [
        "awayCompetitorId",
        "awayTeamId",
        "away_team_id",
        "away_id"
    ], typeof away === "object"
        ? firstValue(away, ["id", "teamId"], 0)
        : 0);

    const homeLogo = firstValue(raw, [
        "homeLogo",
        "home_logo",
        "homeTeamLogo",
        "home_team_logo"
    ], typeof home === "object"
        ? firstValue(home, ["logo", "image", "imageUrl"], "")
        : "");

    const awayLogo = firstValue(raw, [
        "awayLogo",
        "away_logo",
        "awayTeamLogo",
        "away_team_logo"
    ], typeof away === "object"
        ? firstValue(away, ["logo", "image", "imageUrl"], "")
        : "");

    const timestamp = toMillis(firstValue(raw, [
        "timestamp",
        "matchTimeMillis",
        "date",
        "matchDate",
        "match_date",
        "datetime",
        "startTime",
        "start_time",
        "kickoff"
    ], ""));

    const status = getStatus(raw);
    const numericId = Number(id);
    const numericCompetitionId = Number(competitionId);

    return {
        gameId: Number.isFinite(numericId) ? numericId : String(id),
        apiFixtureId: Number.isFinite(numericId) ? numericId : String(id),
        apiProvider: "king",

        competitionId: Number.isFinite(numericCompetitionId)
            ? numericCompetitionId
            : String(competitionId || "0"),

        competitionName: String(competitionName || ""),
        sportId: numberOrZero(firstValue(raw, ["sportId", "sport_id"], 1)) || 1,

        homeCompetitorId: numberOrZero(homeId),
        awayCompetitorId: numberOrZero(awayId),

        homeTeam: String(homeName),
        awayTeam: String(awayName),

        homeLogo: String(homeLogo || ""),
        awayLogo: String(awayLogo || ""),

        homeScore: numberOrZero(firstValue(raw, [
            "homeScore", "home_score", "homeGoals", "home_goals"
        ], 0)),

        awayScore: numberOrZero(firstValue(raw, [
            "awayScore", "away_score", "awayGoals", "away_goals"
        ], 0)),

        timestamp: timestamp,
        matchTimeMillis: timestamp,

        status: status.status,
        shortStatus: status.shortStatus,

        round: String(firstValue(raw, ["round", "stage"], "")),
        season: numberOrZero(firstValue(raw, ["season", "seasonId"], 0)),

        stadium: String(firstValue(raw, ["stadium", "venue"], "")),

        goalEvents: Array.isArray(raw.goalEvents)
            ? raw.goalEvents
            : [],

        streamUrl: String(firstValue(raw, ["streamUrl", "stream_url"], ""))
    };
}

function findMatches(data) {
    if (Array.isArray(data)) {
        return data;
    }

    if (!data || typeof data !== "object") {
        return null;
    }

    const keys = [
        "matches",
        "livescores",
        "liveScores",
        "fixtures",
        "games",
        "results",
        "data",
        "response"
    ];

    for (let i = 0; i < keys.length; i++) {
        if (Array.isArray(data[keys[i]])) {
            return data[keys[i]];
        }
    }

    return null;
}

async function fetchMatches(options) {
    options = options || {};

    const date = options.date;
    const parserSettings = options.parserSettings || {};

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new Error("തീയതി തെറ്റാണ്. YYYY-MM-DD വേണം.");
    }

    const url = getApiUrl(parserSettings, date);

    console.log("King API URL:", url);

    const response = await axios.get(url, {
        timeout: 30000,
        headers: {
            "Accept": "application/json"
        }
    });

    const rawMatches = findMatches(response.data);

    if (!rawMatches) {
        throw new Error(
            "King API response format തിരിച്ചറിയാൻ കഴിഞ്ഞില്ല. " +
            "API-യുടെ JSON response പരിശോധിക്കുക."
        );
    }

    const unique = Object.create(null);

    rawMatches.forEach(function (raw) {
        const match = normalize(raw);

        if (match) {
            unique[String(match.gameId)] = match;
        }
    });

    const matches = Object.keys(unique).map(function (id) {
        return unique[id];
    });

    console.log(
        "King API " + date + ": " + matches.length + " matches"
    );

    return matches;
}

module.exports = {
    fetchMatches: fetchMatches
};
