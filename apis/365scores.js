
"use strict";

var axios = require("axios");

var BASE_URL = "https://webws.365scores.com/web/games/";
var CATALOG_URL = "https://webws.365scores.com/web/sports/";
var GAME_URL = "https://webws.365scores.com/web/game/";

var TIME_ZONE = "Asia/Kolkata";
var PROVIDER_NAME = "365scores";

var competitionCache = {};
var sportCache = {};

function toNumber(value) {
    if (value === null || value === undefined || value === "") {
        return 0;
    }

    var number = Number(value);
    return isNaN(number) ? 0 : number;
}

function toStringValue(value) {
    if (value === null || value === undefined) {
        return "";
    }

    return String(value);
}

function firstValue() {
    for (var i = 0; i < arguments.length; i++) {
        if (
            arguments[i] !== null &&
            arguments[i] !== undefined &&
            arguments[i] !== ""
        ) {
            return arguments[i];
        }
    }

    return "";
}

function getResponseData(response) {
    if (
        response &&
        response.data &&
        typeof response.data === "object"
    ) {
        return response.data;
    }

    return {};
}

function getCompetitionId(item) {
    item = item || {};

    return toNumber(firstValue(
        item.competitionId,
        item.id,
        item.competition && item.competition.id
    ));
}

function getCompetitionName(item) {
    item = item || {};

    var competition = item.competition || {};
    var tournament = item.tournament || {};
    var league = item.league || {};

    return toStringValue(firstValue(
        item.competitionName,
        item.competitionDisplayName,
        competition.name,
        competition.competitionName,
        competition.shortName,
        tournament.name,
        tournament.competitionName,
        league.name,
        item.leagueName
    ));
}

function addCompetitions(list) {
    if (!Array.isArray(list)) {
        return;
    }

    list.forEach(function (item) {
        if (!item) {
            return;
        }

        var id = getCompetitionId(item);
        var name = getCompetitionName(item);

        if (!id || !name) {
            return;
        }

        competitionCache[String(id)] = {
            id: id,
            name: name,
            country: toStringValue(firstValue(
                item.countryName,
                item.country
            )),
            logo: toStringValue(firstValue(
                item.logo,
                item.image,
                item.competitionLogo
            ))
        };
    });
}

function addSports(list) {
    if (!Array.isArray(list)) {
        return;
    }

    list.forEach(function (item) {
        if (!item) {
            return;
        }

        var id = toNumber(firstValue(
            item.id,
            item.sportId
        ));

        var name = toStringValue(firstValue(
            item.name,
            item.sportName
        ));

        if (id && name) {
            sportCache[String(id)] = {
                id: id,
                name: name,
                logo: toStringValue(firstValue(
                    item.logo,
                    item.image
                ))
            };
        }
    });
}

function normalizeGoalEvents(events) {
    if (!Array.isArray(events)) {
        return [];
    }

    return events.map(function (event) {
        event = event || {};

        var player = event.player || {};
        var assist = event.assist || {};
        var competitor = event.competitor || {};
        var team = event.team || {};

        return {
            competitorId: toNumber(firstValue(
                event.competitorId,
                competitor.id,
                event.teamId,
                team.id
            )),

            gameTime: toStringValue(firstValue(
                event.gameTime,
                event.minute,
                event.time,
                event.elapsed
            )),

            playerId: toNumber(firstValue(
                event.playerId,
                player.id,
                event.scorerId
            )),

            playerName: toStringValue(firstValue(
                event.playerName,
                player.name,
                event.scorerName
            )),

            type: toStringValue(firstValue(
                event.type,
                event.eventType,
                event.detail,
                event.name
            )),

            assistId: toNumber(firstValue(
                event.assistId,
                assist.id,
                event.assistPlayerId
            )),

            assistName: toStringValue(firstValue(
                event.assistName,
                assist.name,
                event.assistPlayerName
            ))
        };
    });
}

function normalizeSport(sport) {
    sport = sport || {};

    return {
        id: toNumber(firstValue(
            sport.id,
            sport.sportId
        )),

        name: toStringValue(firstValue(
            sport.name,
            sport.sportName
        )),

        logo: toStringValue(firstValue(
            sport.logo,
            sport.image
        ))
    };
}

function normalizeCompetition(competition) {
    competition = competition || {};

    return {
        id: getCompetitionId(competition),

        name: getCompetitionName(competition),

        country: toStringValue(firstValue(
            competition.country,
            competition.countryName
        )),

        logo: toStringValue(firstValue(
            competition.logo,
            competition.image,
            competition.competitionLogo
        ))
    };
}

function findCompetition(game) {
    game = game || {};

    var id = getCompetitionId(game);
    var name = getCompetitionName(game);

    var nestedLists = [
        game.competitions,
        game.tournaments,
        game.leagues
    ];

    for (var i = 0; i < nestedLists.length; i++) {
        var list = nestedLists[i];

        if (!Array.isArray(list)) {
            continue;
        }

        for (var j = 0; j < list.length; j++) {
            var item = list[j] || {};
            var itemId = getCompetitionId(item);

            if (!name && (!id || !itemId || itemId === id)) {
                name = getCompetitionName(item);
            }

            if (!id && itemId && getCompetitionName(item)) {
                id = itemId;
                name = getCompetitionName(item);
            }
        }
    }

    var cached = id
        ? competitionCache[String(id)]
        : null;

    if (!name && cached) {
        name = cached.name;
    }

    var country = toStringValue(firstValue(
        game.countryName,
        game.country,
        game.competition && game.competition.countryName,
        cached && cached.country
    ));

    var logo = toStringValue(firstValue(
        game.competitionLogo,
        game.competitionImage,
        game.competition && game.competition.logo,
        cached && cached.logo
    ));

    return {
        id: id,
        name: name,
        country: country,
        logo: logo
    };
}

function normalizeMatch(game) {
    game = game || {};

    var home = game.homeCompetitor || {};
    var away = game.awayCompetitor || {};
    var sport = game.sport || {};

    var competitionInfo = findCompetition(game);

    var sportId = toNumber(firstValue(
        game.sportId,
        sport.id
    ));

    var sportName = toStringValue(firstValue(
        game.sportName,
        sport.name,
        sportCache[String(sportId)] &&
            sportCache[String(sportId)].name
    ));

    var homeScore = firstValue(
        game.homeScore,
        game.homeCompetitorScore,
        home.score
    );

    var awayScore = firstValue(
        game.awayScore,
        game.awayCompetitorScore,
        away.score
    );

    var gameDate = firstValue(
        game.startTime,
        game.startDate,
        game.date,
        game.gameTime
    );

    var status = firstValue(
        game.statusText,
        game.status,
        game.gameStatus
    );

    var match = {
        gameId: toNumber(firstValue(
            game.id,
            game.gameId,
            game.eventId
        )),

        sportId: sportId,

        sportName: sportName,

        competitionId: competitionInfo.id,

        competition: competitionInfo.name || "Unknown Competition",

        country: competitionInfo.country,

        competitionLogo: competitionInfo.logo,

        season: toStringValue(firstValue(
            game.seasonName,
            game.season
        )),

        homeTeam: toStringValue(firstValue(
            game.homeCompetitorName,
            home.name,
            game.homeTeam
        )),

        awayTeam: toStringValue(firstValue(
            game.awayCompetitorName,
            away.name,
            game.awayTeam
        )),

        homeTeamId: toNumber(firstValue(
            game.homeCompetitorId,
            home.id
        )),

        awayTeamId: toNumber(firstValue(
            game.awayCompetitorId,
            away.id
        )),

        homeLogo: toStringValue(firstValue(
            game.homeCompetitorLogo,
            home.logo,
            home.image
        )),

        awayLogo: toStringValue(firstValue(
            game.awayCompetitorLogo,
            away.logo,
            away.image
        )),

        homeScore: homeScore === "" ? "" : toNumber(homeScore),

        awayScore: awayScore === "" ? "" : toNumber(awayScore),

        timestamp: toNumber(firstValue(
            game.startTimeSeconds,
            game.timestamp,
            game.startTimestamp
        )),

        matchTimeMillis: toNumber(firstValue(
            game.startTimeMillis,
            game.matchTimeMillis
        )),

        matchDate: toStringValue(gameDate),

        status: toStringValue(status),

        shortStatus: toStringValue(firstValue(
            game.statusGroup,
            game.shortStatus,
            game.statusCode
        )),

        stadium: toStringValue(firstValue(
            game.venueName,
            game.stadiumName,
            game.venue
        )),

        goalEvents: normalizeGoalEvents(firstValue(
            game.goalEvents,
            game.events,
            []
        )),

        streamUrl: ""
    };

    if (!match.timestamp && match.matchDate) {
        var parsedDate = Date.parse(match.matchDate);

        if (!isNaN(parsedDate)) {
            match.timestamp = Math.floor(parsedDate / 1000);
            match.matchTimeMillis = parsedDate;
        }
    }

    if (!match.matchTimeMillis && match.timestamp) {
        match.matchTimeMillis = match.timestamp * 1000;
    }

    return match;
}

function formatDate(date) {
    var day = String(date.getDate());
    var month = String(date.getMonth() + 1);
    var year = String(date.getFullYear());

    if (day.length < 2) {
        day = "0" + day;
    }

    if (month.length < 2) {
        month = "0" + month;
    }

    return day + "/" + month + "/" + year;
}

function getDateRange(options) {
    options = options || {};

    if (options.startDate && options.endDate) {
        return {
            startDate: options.startDate,
            endDate: options.endDate
        };
    }

    var now = new Date();

    var start = new Date(now.getTime());
    start.setDate(start.getDate() - 1);

    var end = new Date(now.getTime());
    end.setDate(end.getDate() + 1);

    return {
        startDate: formatDate(start),
        endDate: formatDate(end)
    };
}

async function fetchCatalog() {
    var response = await axios.get(CATALOG_URL, {
        params: {
            appTypeId: 5,
            langId: 1,
            timezoneName: TIME_ZONE
        },
        timeout: 30000
    });

    var data = getResponseData(response);

    var sports = Array.isArray(data.sports)
        ? data.sports
        : [];

    var countries = Array.isArray(data.countries)
        ? data.countries
        : [];

    var competitions = Array.isArray(data.competitions)
        ? data.competitions
        : [];

    addSports(sports);
    addCompetitions(competitions);

    return {
        provider: PROVIDER_NAME,
        sports: sports.map(normalizeSport),
        countries: countries,
        competitions: competitions.map(normalizeCompetition),
        liveGamesCount: toNumber(firstValue(
            data.liveGamesCount,
            data.liveGames,
            0
        ))
    };
}

async function fetchMatches(options) {
    options = options || {};

    var sportIds = Array.isArray(options.sportIds)
        ? options.sportIds
        : [];

    if (sportIds.length === 0) {
        throw new Error(
            "365Scores: No sport IDs were provided."
        );
    }

    var range = getDateRange(options);
    var allMatches = [];
    var seen = {};

    for (var i = 0; i < sportIds.length; i++) {
        var sportId = sportIds[i];

        try {
            var response = await axios.get(BASE_URL, {
                params: {
                    sports: sportId,
                    startDate: range.startDate,
                    endDate: range.endDate,
                    showOdds: true,
                    appTypeId: 5,
                    langId: 1,
                    timezoneName: TIME_ZONE
                },
                timeout: 30000
            });

            var data = getResponseData(response);

            // Populate lookup caches from this games response too.
            addSports(data.sports);
            addCompetitions(data.competitions);

            var games = Array.isArray(data.games)
                ? data.games
                : [];

            for (var j = 0; j < games.length; j++) {
                var game = games[j] || {};

                // Some responses provide competition metadata
                // separately, while others embed it in each game.
                var inlineCompetition = game.competition || {};

                if (
                    getCompetitionId(game) &&
                    getCompetitionName(game)
                ) {
                    addCompetitions([game]);
                } else if (
                    getCompetitionId(inlineCompetition) &&
                    getCompetitionName(inlineCompetition)
                ) {
                    addCompetitions([inlineCompetition]);
                }

                var normalized = normalizeMatch(game);

                if (!normalized.gameId) {
                    continue;
                }

                var key = String(normalized.gameId);

                if (seen[key]) {
                    continue;
                }

                seen[key] = true;
                allMatches.push(normalized);
            }
        } catch (error) {
            console.error(
                "365Scores fetch failed for sport " +
                sportId +
                ": " +
                (error.message || error)
            );
        }
    }

    return allMatches;
}

async function fetchGameDetails(gameId) {
    if (!gameId) {
        throw new Error(
            "365Scores: gameId is required."
        );
    }

    var response = await axios.get(GAME_URL, {
        params: {
            gameId: gameId,
            appTypeId: 5,
            langId: 1,
            timezoneName: TIME_ZONE
        },
        timeout: 30000
    });

    var data = getResponseData(response);

    addSports(data.sports);
    addCompetitions(data.competitions);

    var game = data.game || data;

    if (game.competition) {
        addCompetitions([game.competition]);
    }

    if (
        getCompetitionId(game) &&
        getCompetitionName(game)
    ) {
        addCompetitions([game]);
    }

    return normalizeMatch(game);
}

module.exports = {
    providerName: PROVIDER_NAME,

    fetchCatalog: fetchCatalog,

    fetchMatches: fetchMatches,

    fetchGameDetails: fetchGameDetails,

    normalizeMatch: normalizeMatch,

    normalizeSport: normalizeSport,

    normalizeCompetition: normalizeCompetition,

    normalizeGoalEvents: normalizeGoalEvents
};
