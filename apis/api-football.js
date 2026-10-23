
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

        if (Object.keys(serviceAccount).length === 0) {
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
        const request = https.get(url, {
            headers: {
                "x-apisports-key": apiKey
            },
            timeout: 30000
        }, function (response) {
            let body = "";

            response.on("data", function (chunk) {
                body += chunk;
            });

            response.on("end", function () {
                if (response.statusCode < 200 ||
                    response.statusCode >= 300) {
                    reject(new Error(
                        "API-Football HTTP " + response.statusCode
                    ));
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
                } catch (error) {
                    reject(new Error("Invalid API-Football JSON"));
                }
            });
        });

        request.on("timeout", function () {
            request.destroy(new Error("API-Football request timeout"));
        });

        request.on("error", reject);
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

function getShortStatus(short, elapsed) {
    const status = String(short || "NS").toUpperCase();

    if (["1H", "2H", "HT", "ET", "P", "LIVE", "BT",
         "INT", "SUSP", "PEN"].indexOf(status) !== -1) {
        return {
            status: elapsed !== null && elapsed !== undefined
                ? String(elapsed)
                : status,
            shortStatus: "LIVE"
        };
    }

    if (status === "FT" || status === "AET" || status === "PEN") {
        return { status: status, shortStatus: status };
    }

    return { status: status, shortStatus: status };
}

async function fetchFixtures(date, apiKey) {
    const url = API_URL + "?date=" + encodeURIComponent(date) +
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

    const selectionSnapshot = await db.ref("competition_selection")
        .once("value");
    const selection = selectionSnapshot.val() || {};

    const oldProviderSnapshot = await db.ref(
        "settings/last_synced_api_provider"
    ).once("value");

    const oldProvider = String(oldProviderSnapshot.val() || "")
        .toLowerCase();

    const providerChanged = oldProvider !== PROVIDER;
    const dates = [getDate(-1), getDate(0), getDate(1)];
    const fixtures = [];

    for (let i = 0; i < dates.length; i++) {
        const list = await fetchFixtures(dates[i], apiKey);

        list.forEach(function (fixture) {
            fixtures.push(fixture);
        });
    }

    if (fixtures.length === 0) {
        throw new Error(
            "API-Football returned no fixtures. Firebase was not replaced."
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

        const fixtureId = fixture.id;
        const leagueId = league.id;

        if (fixtureId === undefined || leagueId === undefined) {
            return;
        }

        const compId = String(leagueId);
        const selected = selection[compId] === true;

        competitions[compId] = {
            id: compId,
            sportId: "1",
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

        const status = getShortStatus(
            statusData.short,
            statusData.elapsed
        );

        matches[String(fixtureId)] = {
            gameId: String(fixtureId),
            apiFixtureId: String(fixtureId),
            apiProvider: PROVIDER,
            competitionId: compId,
            competitionName: league.name || "",
            league: league.name || "",
            season: league.season || "",
            round: league.round || "",
            homeTeam: teams.home ? teams.home.name : "",
            awayTeam: teams.away ? teams.away.name : "",
            homeTeamId: teams.home ? String(teams.home.id || "") : "",
            awayTeamId: teams.away ? String(teams.away.id || "") : "",
            homeLogo: teams.home ? teams.home.logo || "" : "",
            awayLogo: teams.away ? teams.away.logo || "" : "",
            homeScore: goals.home === null || goals.home === undefined
                ? 0 : Number(goals.home),
            awayScore: goals.away === null || goals.away === undefined
                ? 0 : Number(goals.away),
            timestamp: timestamp,
            matchTimeMillis: timestamp,
            status: status.status,
            shortStatus: status.shortStatus,
            streamUrl: "",
            sportId: "1"
        };
    });

    const updates = {};
    const oldMatchesSnapshot = await db.ref("matches").once("value");
    const oldMatches = oldMatchesSnapshot.val() || {};

    if (providerChanged) {
        updates["matches"] = matches;
        updates["competitions"] = competitions;

        const newSelection = {};

        Object.keys(competitions).forEach(function (id) {
            newSelection[id] = false;
        });

        updates["competition_selection"] = newSelection;
        updates["settings/last_synced_api_provider"] = PROVIDER;

        console.log("Provider changed. Saved new provider data.");
        console.log("Matches saved:", Object.keys(matches).length);
        console.log("Competitions discovered:",
            Object.keys(competitions).length);

        await db.ref().update(updates);
        return;
    }

    Object.keys(matches).forEach(function (id) {
        const previous = oldMatches[id] || {};

        matches[id].streamUrl = previous.streamUrl || "";

        if (previous.goalEvents !== undefined) {
            matches[id].goalEvents = previous.goalEvents;
        }

        if (previous.adminNotes !== undefined) {
            matches[id].adminNotes = previous.adminNotes;
        }

        updates["matches/" + id] = matches[id];
    });

    Object.keys(competitions).forEach(function (id) {
        updates["competitions/" + id] = competitions[id];

        if (selection[id] === undefined) {
            updates["competition_selection/" + id] = false;
        }
    });

    updates["settings/last_synced_api_provider"] = PROVIDER;

    if (Object.keys(updates).length > 0) {
        await db.ref().update(updates);
    }

    console.log("API-Football sync completed.");
    console.log("Selected matches updated:", Object.keys(matches).length);
    console.log("Competitions discovered:", Object.keys(competitions).length);
}

main().catch(function (error) {
    console.error("API-Football sync error:", error);
    process.exit(1);
});
