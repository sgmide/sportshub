
"use strict";

const admin = require("firebase-admin");
const https = require("https");

const PROVIDER = "apifootball";
const API_URL = "https://v3.football.api-sports.io/fixtures";
const TIME_ZONE = "Asia/Kolkata";

function initFirebase() {
    if (!admin.apps.length) {
        const serviceAccount = JSON.parse(
            process.env.FIREBASE_SERVICE_ACCOUNT || "{}"
        );

        if (!Object.keys(serviceAccount).length) {
            throw new Error("FIREBASE_SERVICE_ACCOUNT is missing");
        }

        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            databaseURL: process.env.FIREBASE_DATABASE_URL
        });
    }

    return admin.database();
}

function requestJson(url, apiKey) {
    return new Promise(function (resolve, reject) {
        const req = https.get(url, {
            headers: { "x-apisports-key": apiKey },
            timeout: 30000
        }, function (res) {
            let body = "";

            res.on("data", function (chunk) {
                body += chunk;
            });

            res.on("end", function () {
                if (res.statusCode < 200 || res.statusCode >= 300) {
                    reject(new Error("API-Football HTTP " + res.statusCode));
                    return;
                }

                try {
                    const json = JSON.parse(body);

                    if (json.errors &&
                        Object.keys(json.errors).length > 0) {
                        reject(new Error(
                            "API-Football errors: " +
                            JSON.stringify(json.errors)
                        ));
                        return;
                    }

                    resolve(json);
                } catch (e) {
                    reject(new Error("Invalid API-Football JSON"));
                }
            });
        });

        req.on("timeout", function () {
            req.destroy(new Error("API-Football request timeout"));
        });

        req.on("error", reject);
    });
}

function getDate(offset) {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + offset);

    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).formatToParts(date);

    const values = {};

    parts.forEach(function (part) {
        values[part.type] = part.value;
    });

    return values.year + "-" + values.month + "-" + values.day;
}

function formatDateTime(timestamp) {
    const date = new Date(timestamp);

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

    const dateText =
        values.day + "-" + values.month + "-" + values.year;

    const timeText = new Intl.DateTimeFormat("en-GB", {
        timeZone: TIME_ZONE,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
    }).format(date);

    return {
        date: dateText,
        time: timeText
    };
}

function getShortStatus(short, elapsed) {
    const code = String(short || "NS").toUpperCase();

    const liveCodes = [
        "1H", "2H", "HT", "ET", "P", "BT",
        "INT", "LIVE", "SUSP"
    ];

    if (liveCodes.indexOf(code) !== -1) {
        return {
            status: elapsed !== null && elapsed !== undefined
                ? String(elapsed) + "'"
                : code,
            shortStatus: "LIVE"
        };
    }

    if (code === "FT" || code === "AET" || code === "PEN") {
        return {
            status: code,
            shortStatus: code
        };
    }

    if (code === "PST") {
        return { status: "Postponed", shortStatus: "PST" };
    }

    if (code === "CANC") {
        return { status: "Cancelled", shortStatus: "CANC" };
    }

    if (code === "ABD") {
        return { status: "Abandoned", shortStatus: "ABD" };
    }

    if (code === "NS") {
        return { status: "NS", shortStatus: "NS" };
    }

    if (code === "AWD" || code === "WO") {
        return { status: code, shortStatus: code };
    }

    return { status: code, shortStatus: code };
}

async function fetchFixtures(date, apiKey) {
    const url = API_URL +
        "?date=" + encodeURIComponent(date) +
        "&timezone=" + encodeURIComponent(TIME_ZONE);

    const json = await requestJson(url, apiKey);
    return json.response || [];
}

async function main() {
    const apiKey = process.env.API_FOOTBALL_KEY;

    if (!apiKey) {
        throw new Error("API_FOOTBALL_KEY secret is missing");
    }

    const db = initFirebase();

    const results = await Promise.all([
        db.ref("competitions").once("value"),
        db.ref("competition_selection").once("value"),
        db.ref("settings/last_synced_api_provider").once("value"),
        db.ref("matches").once("value")
    ]);

    const oldCompetitions = results[0].val() || {};
    const selection = results[1].val() || {};
    const oldProvider = String(results[2].val() || "")
        .toLowerCase();
    const oldMatches = results[3].val() || {};

    const providerChanged = oldProvider !== PROVIDER;

    const dates = [
        getDate(-1),
        getDate(0),
        getDate(1)
    ];

    const fixtureLists = await Promise.all(
        dates.map(function (date) {
            return fetchFixtures(date, apiKey);
        })
    );

    const fixtures = [];

    fixtureLists.forEach(function (list) {
        list.forEach(function (item) {
            fixtures.push(item);
        });
    });

    if (fixtures.length === 0) {
        throw new Error(
            "API-Football returned no fixtures. " +
            "Existing Firebase matches were not changed."
        );
    }

    const competitions = {};
    const matches = {};

    fixtures.forEach(function (item) {
        const fixture = item.fixture || {};
        const league = item.league || {};
        const teams = item.teams || {};
        const goals = item.goals || {};
        const statusData = fixture.status || {};

        if (fixture.id == null || league.id == null) {
            return;
        }

        const fixtureId = Number(fixture.id);
        const compId = String(league.id);
        const oldCompetition = oldCompetitions[compId] || {};

        const selected = !providerChanged && (
            selection[compId] === true ||
            oldCompetition.selected === true
        );

        competitions[compId] = {
            id: Number(league.id),
            sportId: 1,
            name: league.name || "Competition",
            country: league.country || "",
            logo: league.logo || "",
            season: league.season || "",
            apiProvider: PROVIDER,
            selected: selected
        };

        if (!selected) {
            return;
        }

        const timestamp = fixture.timestamp
            ? Number(fixture.timestamp) * 1000
            : new Date(fixture.date || Date.now()).getTime();

        const dateTime = formatDateTime(timestamp);

        const status = getShortStatus(
            statusData.short,
            statusData.elapsed
        );

        const previous = providerChanged
            ? {}
            : (oldMatches[String(fixtureId)] || {});

        const homeScore = goals.home == null
            ? null
            : Number(goals.home);

        const awayScore = goals.away == null
            ? null
            : Number(goals.away);

        let score = "VS";

        if (homeScore !== null && awayScore !== null) {
            score = homeScore + " - " + awayScore;
        }

        matches[String(fixtureId)] = {
            gameId: fixtureId,
            apiFixtureId: fixtureId,
            apiProvider: PROVIDER,

            competitionId: Number(league.id),
            competitionName: league.name || "",
            league: league.name || "",
            season: league.season || "",
            round: league.round || "",

            home: teams.home ? teams.home.name || "" : "",
            away: teams.away ? teams.away.name || "" : "",

            homeTeam: teams.home ? teams.home.name || "" : "",
            awayTeam: teams.away ? teams.away.name || "" : "",

            homeTeamId: teams.home && teams.home.id != null
                ? Number(teams.home.id) : 0,
            awayTeamId: teams.away && teams.away.id != null
                ? Number(teams.away.id) : 0,

            homeLogo: teams.home ? teams.home.logo || "" : "",
            awayLogo: teams.away ? teams.away.logo || "" : "",

            homeScore: homeScore,
            awayScore: awayScore,
            score: score,

            date: dateTime.date,
            time: dateTime.time,
            stadium: previous.stadium || "",

            timestamp: timestamp,
            matchTimeMillis: timestamp,

            status: status.status,
            shortStatus: status.shortStatus,

            streamUrl: previous.streamUrl || "",
            goalEvents: previous.goalEvents,
            adminNotes: previous.adminNotes,

            sportId: 1
        };

        if (matches[String(fixtureId)].goalEvents === undefined) {
            delete matches[String(fixtureId)].goalEvents;
        }

        if (matches[String(fixtureId)].adminNotes === undefined) {
            delete matches[String(fixtureId)].adminNotes;
        }
    });

    const updates = {};

    if (providerChanged) {
        // Provider maariyappol pazhaya provider matches neekkum.
        // Puthiya competitions Admin-il veendum select cheyyanam.
        updates["matches"] = {};
        updates["competitions"] = competitions;
        updates["competition_selection"] = {};

        Object.keys(competitions).forEach(function (id) {
            updates["competition_selection/" + id] = false;
        });

        updates["settings/last_synced_api_provider"] = PROVIDER;

        await db.ref().update(updates);

        console.log("Provider changed to API-Football.");
        console.log("Matches cleared: new competitions need selection.");
        console.log("Competitions discovered:", Object.keys(competitions).length);
        return;
    }

    // Current fixture window-ile selected matches maathram save cheyyum.
    // Removed/stale matches automatic-aayi neekkum.
    updates["matches"] = matches;
    updates["competitions"] = competitions;

    Object.keys(competitions).forEach(function (id) {
        if (selection[id] === undefined) {
            updates["competition_selection/" + id] = false;
        }
    });

    updates["settings/last_synced_api_provider"] = PROVIDER;

    await db.ref().update(updates);

    console.log("API-Football sync completed.");
    console.log("Selected matches saved:", Object.keys(matches).length);
    console.log("Competitions discovered:", Object.keys(competitions).length);
}

main().catch(function (error) {
    console.error("API-Football sync error:", error);
    process.exit(1);
});
