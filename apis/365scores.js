
"use strict";

const axios = require("axios");

const BASE_URL = "https://webws.365scores.com/web/games/";
const TIME_ZONE = "Asia/Kolkata";

function formatDate(date) {
    const parts = date.split("-");
    return parts[2] + "/" + parts[1] + "/" + parts[0];
}

function toMillis(value) {
    if (value == null || value === "") return 0;

    if (typeof value === "number") {
        return value < 1000000000000
            ? value * 1000
            : value;
    }

    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function getLogo(team) {
    if (!team) return "";

    const directLogo =
        team.logo ||
        team.imageUrl ||
        team.imageURL ||
        team.logoUrl ||
        team.logoURL ||
        team.image ||
        "";

    if (
        typeof directLogo === "string" &&
        /^https?:\/\//i.test(directLogo)
    ) {
        return directLogo;
    }

    const id = team.id;
    const version = team.imageVersion;

    if (id != null && version != null) {
        return (
            "https://imagecache.365scores.com/image/upload/" +
            "f_png,w_60,h_60,c_limit,q_auto:eco/" +
            "v" + encodeURIComponent(String(version)) +
            "/Competitors/" +
            encodeURIComponent(String(id))
        );
    }

    return "";
}

function getHomeAway(game) {
    const competitors = Array.isArray(game.competitors)
        ? game.competitors
        : [];

    const home = game.homeCompetitor ||
        competitors.find(function (item) {
            return item.isHome === true ||
                item.position === "home" ||
                item.qualifier === "home";
        }) ||
        competitors[0] ||
        {};

    const away = game.awayCompetitor ||
        competitors.find(function (item) {
            return item.isAway === true ||
                item.position === "away" ||
                item.qualifier === "away";
        }) ||
        competitors[1] ||
        {};

    return {
        home: home,
        away: away
    };
}

function getStatus(game) {
    const status = game.status || {};
    let text = "";

    if (typeof status === "string") {
        text = status;
    } else {
        text = status.shortName ||
            status.name ||
            status.description ||
            "";
    }

    text = game.shortStatusText ||
        game.statusText ||
        game.shortStatus ||
        text;

    if (text) return String(text);

    const minute = Number(game.gameTime);

    if (Number.isFinite(minute) && minute > 0) {
        return String(minute) + "'";
    }

    return "NS";
}

function getScore(team) {
    if (!team) return 0;

    if (team.score != null) return team.score;
    if (team.currentScore != null) return team.currentScore;

    return 0;
}

function getDateText(timestamp) {
    if (!timestamp) return "";

    return new Intl.DateTimeFormat("en-GB", {
        timeZone: TIME_ZONE,
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
    })
        .format(new Date(timestamp))
        .replace(/\//g, "-");
}

function getTimeText(timestamp) {
    if (!timestamp) return "";

    return new Intl.DateTimeFormat("en-US", {
        timeZone: TIME_ZONE,
        hour: "2-digit",
        minute: "2-digit",
        hour12: true
    }).format(new Date(timestamp));
}

function normalize(game, requestedSportId) {
    if (!game) return null;

    const teams = getHomeAway(game);
    const home = teams.home;
    const away = teams.away;

    const competition = game.competition || {};

    const rawId = game.id != null
        ? game.id
        : game.gameId;

    if (rawId == null) return null;

    const gameId = Number(rawId);

    if (!Number.isFinite(gameId) || gameId <= 0) {
        return null;
    }

    const timestamp = toMillis(
        game.startTime ||
        game.startTimestamp ||
        game.startDate ||
        game.date
    );

    const rawSportId = game.sportId != null
        ? game.sportId
        : (
            game.sport &&
            game.sport.id != null
                ? game.sport.id
                : requestedSportId
        );

    const sportId = Number(rawSportId);

    // 365Scores response-ൽ competitionId നേരിട്ട് വരാം.
    // അതിനാൽ competition object ഉണ്ടെന്ന് നിർബന്ധമില്ല.
    const rawCompetitionId =
        game.competitionId != null
            ? game.competitionId
            : (
                competition.id != null
                    ? competition.id
                    : (
                        game.leagueId != null
                            ? game.leagueId
                            : 0
                    )
            );

    const competitionId = Number(rawCompetitionId);

    const competitionName = String(
        game.competitionDisplayName ||
        game.competitionName ||
        competition.name ||
        game.league ||
        ""
    );

    const homeName = String(
        home.name ||
        home.shortName ||
        "Home"
    );

    const awayName = String(
        away.name ||
        away.shortName ||
        "Away"
    );

    const status = getStatus(game);
    const homeScore = getScore(home);
    const awayScore = getScore(away);

    const statusLower = status.toLowerCase();

    const isUpcoming =
        statusLower === "ns" ||
        statusLower === "scheduled" ||
        statusLower === "sched.";

    const score = isUpcoming
        ? "VS"
        : String(homeScore) + " - " + String(awayScore);

    const homeLogo = getLogo(home);
    const awayLogo = getLogo(away);

    if (!homeLogo || !awayLogo) {
        console.log(
            "Logo missing for game " + gameId +
            ": home=" + homeLogo +
            ", away=" + awayLogo
        );
    }

    if (!competitionId || !competitionName) {
        console.log(
            "Competition information missing for game " +
            gameId +
            ": competitionId=" + competitionId +
            ", competitionName=" + competitionName
        );
    }

    return {
        gameId: gameId,
        apiFixtureId: gameId,
        apiProvider: "365scores",

        competitionId: competitionId,
        competitionName: competitionName,
        league: competitionName,

        sportId: Number.isFinite(sportId)
            ? sportId
            : requestedSportId,

        homeCompetitorId: Number(home.id || 0),
        awayCompetitorId: Number(away.id || 0),

        home: homeName,
        away: awayName,

        homeTeam: homeName,
        awayTeam: awayName,

        homeLogo: homeLogo,
        awayLogo: awayLogo,

        homeScore: Number(homeScore || 0),
        awayScore: Number(awayScore || 0),

        score: score,

        goalEvents: Array.isArray(game.goalEvents)
            ? game.goalEvents
            : (
                Array.isArray(game.events)
                    ? game.events
                    : []
            ),

        timestamp: timestamp,
        matchTimeMillis: timestamp,

        date: getDateText(timestamp),
        time: getTimeText(timestamp),

        status: status,

        shortStatus: String(
            game.shortStatusText ||
            game.shortStatus ||
            status
        ),

        round: game.roundName ||
            competition.round ||
            "",

        season: game.seasonNum ||
            competition.season ||
            0,

        stadium: game.stadiumName ||
            game.stadium ||
            "",

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

    const baseUrl = parserSettings.api_url || BASE_URL;

    const sportIds = Array.isArray(options.sportIds)
        ? options.sportIds
        : [];

    const uniqueSportIds = Array.from(
        new Set(
            sportIds.map(Number).filter(function (id) {
                return Number.isFinite(id) && id > 0;
            })
        )
    );

    if (uniqueSportIds.length === 0) {
        throw new Error(
            "No sports selected. Check settings/selected_sports."
        );
    }

    const unique = Object.create(null);

    for (const sportId of uniqueSportIds) {
        try {
            const response = await axios.get(baseUrl, {
                timeout: 30000,

                params: {
                    appTypeId: 5,
                    langId: 1,
                    timezoneName: TIME_ZONE,
                    userCountryId: 113,
                    sports: sportId,
                    startDate: formatDate(date),
                    endDate: formatDate(date),
                    showOdds: true,
                    onlyMajorGames: false,
                    withTop: true
                },

                headers: {
                    Accept: "application/json",
                    "User-Agent": "Mozilla/5.0"
                }
            });

            const data = response.data || {};

            if (!Array.isArray(data.games)) {
                throw new Error(
                    "365Scores response does not contain a games array"
                );
            }

            data.games.forEach(function (game) {
                const match = normalize(game, sportId);

                if (!match) return;

                const id = String(match.gameId);
                const previous = unique[id];

                if (!previous) {
                    unique[id] = match;
                    return;
                }

                const merged = Object.assign({}, previous);

                Object.keys(match).forEach(function (key) {
                    const value = match[key];

                    if (
                        value !== null &&
                        value !== undefined &&
                        value !== "" &&
                        !(
                            Array.isArray(value) &&
                            value.length === 0
                        )
                    ) {
                        merged[key] = value;
                    }
                });

                if (
                    Array.isArray(previous.goalEvents) &&
                    previous.goalEvents.length > 0 &&
                    (
                        !Array.isArray(match.goalEvents) ||
                        match.goalEvents.length === 0
                    )
                ) {
                    merged.goalEvents = previous.goalEvents;
                }

                unique[id] = merged;
            });

            console.log(
                "365Scores sport " + sportId +
                ": " + data.games.length +
                " games for " + date
            );

        } catch (error) {
            console.error(
                "365Scores error, sport " + sportId +
                ", date " + date +
                ": " + error.message
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
