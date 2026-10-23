
"use strict";

const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

const TIMEZONE = "Asia/Kolkata";
const DEFAULT_PROVIDER = "apifootball";

function initFirebase() {
    if (admin.apps.length) return;

    const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
    const databaseURL = process.env.FIREBASE_DATABASE_URL;

    if (!serviceAccount || !databaseURL) {
        throw new Error("Missing Firebase GitHub Secrets");
    }

    admin.initializeApp({
        credential: admin.credential.cert(JSON.parse(serviceAccount)),
        databaseURL: databaseURL
    });
}

function normalizeProvider(value) {
    const name = String(value || DEFAULT_PROVIDER)
        .trim().toLowerCase();

    if (name === "365" || name === "365scores") {
        return "365scores";
    }

    if (
        name === "api-football" ||
        name === "api_football" ||
        name === "apifootball"
    ) {
        return "apifootball";
    }

    throw new Error("Unsupported provider: " + name);
}

function getLocalDate(offset) {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: TIMEZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).formatToParts(new Date());

    const v = {};
    parts.forEach(function (p) {
        v[p.type] = p.value;
    });

    const d = new Date(Date.UTC(
        Number(v.year),
        Number(v.month) - 1,
        Number(v.day) + offset
    ));

    return d.toISOString().slice(0, 10);
}

function safeKey(value) {
    return String(value).replace(/[.#$[\]/]/g, "_");
}

function loadProvider(name) {
    const file = path.join(__dirname, name + ".js");

    if (!fs.existsSync(file)) {
        throw new Error("Provider file not found: " + file);
    }

    return require(file);
}

function selectedFixture(value) {
    return value === true ||
        (value && typeof value === "object" &&
            value.selected === true);
}

async function main() {
    initFirebase();

    const db = admin.database();
    const settingsRef = db.ref("settings");

    const settingsSnap = await settingsRef.once("value");
    const settings = settingsSnap.val() || {};

    const providerName = normalizeProvider(
        process.env.API_PROVIDER || settings.apiProvider
    );

    const previousProvider = settings.last_synced_api_provider
        ? normalizeProvider(settings.last_synced_api_provider)
        : "";

    const provider = loadProvider(providerName);

    const dates = [
        getLocalDate(-1),
        getLocalDate(0),
        getLocalDate(1)
    ];

    const collected = {};
    let successfulDates = 0;
    const errors = [];

    for (const date of dates) {
        try {
            console.log("Fetching", providerName, date);

            const items = await provider.fetch(date, {
                timezone: TIMEZONE,
                settings: settings
            });

            if (!Array.isArray(items)) {
                throw new Error("Provider did not return an array");
            }

            successfulDates++;

            for (const item of items) {
                const match = provider.normalize(item);

                if (!match || match.gameId == null) continue;

                const id = safeKey(match.gameId);
                collected[id] = match;
            }

            console.log(date + ": " + items.length + " records");
        } catch (error) {
            errors.push(date + ": " + error.message);
            console.error("Request failed:", date, error.message);
        }
    }

    if (successfulDates === 0) {
        throw new Error(
            "All date requests failed. Existing Firebase data preserved. " +
            errors.join(" | ")
        );
    }

    /*
     * Avoid clearing Firebase if the provider returned no usable matches.
     */
    if (Object.keys(collected).length === 0) {
        throw new Error(
            "No valid matches returned. Existing Firebase data preserved."
        );
    }

    const providerChanged =
        previousProvider !== "" &&
        previousProvider !== providerName;

    const [
        oldAvailableSnap,
        oldMatchesSnap,
        selectionSnap,
        competitionSelectionSnap,
        competitionsSnap
    ] = await Promise.all([
        db.ref("availableMatches").once("value"),
        db.ref("matches").once("value"),
        db.ref("selectedFixtures").once("value"),
        db.ref("competition_selection").once("value"),
        db.ref("competitions").once("value")
    ]);

    const oldAvailable = providerChanged
        ? {} : (oldAvailableSnap.val() || {});
    const oldMatches = providerChanged
        ? {} : (oldMatchesSnap.val() || {});
    const fixtureSelections = providerChanged
        ? {} : (selectionSnap.val() || {});
    const competitionSelections = providerChanged
        ? {} : (competitionSelectionSnap.val() || {});
    const oldCompetitions = providerChanged
        ? {} : (competitionsSnap.val() || {});

    /*
     * Keep manually entered stream URLs for the same provider only.
     */
    Object.keys(collected).forEach(function (id) {
        const previous = oldAvailable[id] || oldMatches[id] || {};
        collected[id].streamUrl = previous.streamUrl || "";
    });

    const competitions = {};
    const selectedMatches = {};

    Object.keys(collected).forEach(function (id) {
        const match = collected[id];
        const competitionId = safeKey(match.competitionId || "");

        if (competitionId) {
            const oldCompetition = oldCompetitions[competitionId] || {};
            const isSelected =
                competitionSelections[competitionId] === true ||
                (competitionSelections[competitionId] &&
                    competitionSelections[competitionId].selected === true) ||
                oldCompetition.selected === true;

            competitions[competitionId] = {
                id: String(match.competitionId),
                name: match.league || "Unknown Competition",
                sportId: Number(match.sportId || 1),
                selected: isSelected,
                apiProvider: providerName
            };

            if (isSelected) {
                selectedMatches[id] = match;
            }
        }

        if (selectedFixture(fixtureSelections[id])) {
            selectedMatches[id] = match;
        }
    });

    /*
     * One root update. On provider change, old selections and old-provider
     * data are replaced only after the new provider returned usable matches.
     */
    const updates = {
        availableMatches: collected,
        competitions: competitions,
        competition_selection: {},
        matches: selectedMatches,
        settings: Object.assign({}, settings, {
            apiProvider: providerName,
            last_synced_api_provider: providerName,
            lastSuccessfulSync: Date.now(),
            lastSyncMatchCount: Object.keys(collected).length,
            lastSyncError: errors.join(" | ")
        })
    };

    Object.keys(competitions).forEach(function (id) {
        if (competitions[id].selected) {
            updates.competition_selection[id] = true;
        }
    });

    if (providerChanged) {
        updates.selectedFixtures = null;

        console.log(
            "Provider changed: " + previousProvider +
            " -> " + providerName +
            ". Old-provider selections reset."
        );
    } else {
        updates.selectedFixtures = fixtureSelections;
    }

    await db.ref().update(updates);

    console.log("Provider:", providerName);
    console.log("Matches received:", Object.keys(collected).length);
    console.log("Selected matches:", Object.keys(selectedMatches).length);
    console.log("Successful dates:", successfulDates + "/3");
    console.log("Sync completed.");
}

main().catch(function (error) {
    console.error("Sync failed:", error.message);
    process.exitCode = 1;
});
