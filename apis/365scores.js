
"use strict";

const axios = require("axios");

const BASE_URL =
    "https://webws.365scores.com/web/games/";

function formatDate(date) {
    const parts = date.split("-");
    return parts[2] + "/" + parts[1] + "/" + parts[0];
}

function toMillis(value) {
    if (value == null || value === "") {
        return 0;
    }

    if (typeof value === "number") {
        return value < 1000000000000
            ? value * 1000
            : value;
    }

    const parsed = Date.parse(value);

    return Number.isFinite(parsed) ? parsed : 0;
}

function getLogo(competitor) {
    if (!competitor) {
        return "";
    }

    return competitor.logo ||
        competitor.image ||
        competitor.imageUrl ||
        "";
}

function getStatus(game) {
    const status = game.status || {};

    const text = typeof status === "string"
        ? status
        : (status.shortName || status.name || "");

    const minute = game.gameTime != null
        ? String(game.gameTime)
        : "";

    return minute && /^\d+$/.test(minute)
        ? minute + "'"
        : String(text || "NS");
}

function normalize(game, requestedSportId) {
    const competitors = Array.isArray(game.competitors)
        ? game.competitors
        : [];

    const home = competitors.find(function (item) {
        return item.isHome === true ||
            item.position === "home" ||
            item.qualifier === "home";
    }) || competitors[0] || {};

    const away = competitors.find(function (item) {
        return item.isAway === true ||
            item.position === "away" ||
            item.qualifier === "away";
    }) || competitors[1] || {};

    const competition = game.competition || {};

    const gameId = game.id != null
        ? game.id
        : game.gameId;

    if (gameId == null) {
        return null;
    }

    const timestamp = toMillis(
        game.startTime ||
        game.startTimestamp ||
        game.startDate ||
        game.date
    );

    const status = getStatus(game);

    const homeScore = home.score != null
        ? home.score
        : (home.currentScore != null
            ? home.currentScore
            : 0);

    const awayScore = away.score != null
        ? away.score
        : (away.currentScore != null
            ? away.currentScore
            : 0);

    const sportId = game.sportId != null
        ? Number(game.sportId)
        : (
            game.sport && game.sport.id != null
                ? Number(game.sport.id)
                : Number(requestedSportId)
        );

    return {
        gameId: Number(gameId),
        apiFixtureId: Number(gameId),
        apiProvider: "365scores",

        competitionId: Number(
            competition.id != null
                ? competition.id
                : (game.competitionId || 0)
        ),

        competitionName:
            competition.name ||
            game.competitionName ||
            "",

        sportId: sportId,

        homeCompetitorId: Number(home.id || 0),
        awayCompetitorId: Number(away.id || 0),

        homeTeam: home.name || home.shortName || "Home",
        awayTeam: away.name || away.shortName || "Away",

        homeLogo: getLogo(home),
        awayLogo: getLogo(away),

        homeScore: Number(homeScore || 0),
        awayScore: Number(awayScore || 0),

        goalEvents: Array.isArray(game.goalEvents)
            ? game.goalEvents
            : [],

        timestamp: timestamp,
        matchTimeMillis: timestamp,

        status: status,
        shortStatus: status,

        round: competition.round || "",
        season: competition.season || 0,

        streamUrl: game.streamUrl || ""
    };
}

async function fetchMatches(options) {
    options = options || {};

    const date = options.date;
    const parserSettings = options.parserSettings || {};

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new Error(
            "Invalid date. Expected YYYY-MM-DD"
        );
    }

    const baseUrl =
        parserSettings.api_url ||
        BASE_URL;

    const sportIds = Array.isArray(options.sportIds)
        ? options.sportIds
        : [1];

    if (sportIds.length === 0) {
        throw new Error(
            "No sports selected for 365Scores"
        );
    }

    const unique = Object.create(null);

    for (const sportId of sportIds) {
        try {
            const response = await axios.get(baseUrl, {
                timeout: 30000,

                params: {
                    appTypeId: 5,
                    langId: 1,
                    timezoneName: "Asia/Kolkata",
                    userCountryId: 113,
                    sports: sportId,
                    startDate: formatDate(date),
                    endDate: formatDate(date),
                    showOdds: true,
                    onlyMajorGames: false,
                    withTop: true
                },

                headers: {
                    "Accept": "application/json",
                    "User-Agent": "Mozilla/5.0"
                }
            });

            const data = response.data || {};

            if (!Array.isArray(data.games)) {
                throw new Error(
                    "Unexpected 365Scores response: games array missing"
                );
            }

            const games = data.games;

            games.forEach(function (game) {
                const match = normalize(game, sportId);

                if (match) {
                    unique[String(match.gameId)] = match;
                }
            });

            console.log(
                "365Scores sport " + sportId +
                ": " + games.length + " games"
            );

        } catch (error) {
            console.error(
                "365Scores sport " + sportId +
                " failed: " + error.message
            );

            throw new Error(
                "365Scores fetch failed for sport " +
                sportId + ", date " + date +
                ": " + error.message
            );
        }
    }

    const matches = Object.keys(unique).map(function (id) {
        return unique[id];
    });

    console.log(
        "365Scores total for " + date +
        ": " + matches.length + " matches"
    );

    return matches;
}

module.exports = {
    fetchMatches: fetchMatches
};
