
"use strict";

const admin = require("firebase-admin");
const path = require("path");

const TIME_ZONE = "Asia/Kolkata";
const DEFAULT_PROVIDER = "apifootball";

function getProviderName(settings) {
    let provider = process.env.API_PROVIDER ||
        settings.apiProvider ||
        settings.api_provider ||
        DEFAULT_PROVIDER;

    provider = String(provider).toLowerCase().trim();

    if (provider === "365" || provider === "365scores") {
        return "365scores";
    }

    if (
        provider === "api-football" ||
        provider === "api_football" ||
        provider === "apifootball"
    ) {
        return "api-football";
    }

    throw new Error("Unsupported API provider: " + provider);
}

function loadProvider(name) {
    return require(path.join(__dirname, "apis", name + ".js"));
}

function localDate(offset) {
    const date = new Date();

    date.setUTCDate(date.getUTCDate() + offset);

    return new Intl.DateTimeFormat("en-CA", {
        timeZone: TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).format(date);
}

function cleanId(value) {
    return String(value == null ? "" : value)
        .replace(/[.#$/\[\]]/g, "_")
        .trim();
}

function asObject(value) {
    return value && typeof value === "object" ? value : {};
}

async function main() {
    const serviceAccountJson =
        process.env.FIREBASE_SERVICE_ACCOUNT;

    const databaseURL =
        process.env.FIREBASE_DATABASE_URL;

    if (!serviceAccountJson || !databaseURL) {
        throw new Error(
            "Missing FIREBASE_SERVICE_ACCOUNT or FIREBASE_DATABASE_URL"
        );
    }

    if (!admin.apps.length) {
        admin.initializeApp({
            credential: admin.credential.cert(
                JSON.parse(serviceAccountJson)
            ),
            databaseURL: databaseURL
        });
    }

    const db = admin.database();
    const rootRef = db.ref("/");
    const snapshot = await rootRef.once("value");
    const root = asObject(snapshot.val());

    const settings = asObject(root.settings);
    const providerName = getProviderName(settings);
    const provider = loadProvider(providerName);

    console.log("Selected provider:", providerName);

    const dates = [
        localDate(-1),
        localDate(0),
        localDate(1)
    ];

    const collected = {};
    let successfulRequests = 0;
    let totalRawMatches = 0;

    for (const date of dates) {
        try {
            console.log("Fetching:", date);

            const games = await provider.fetch(date, {
                timezone: TIME_ZONE,
                settings: settings
            });

            if (!Array.isArray(games)) {
                throw new Error("Provider did not return an array");
            }

            successfulRequests++;
            totalRawMatches += games.length;

            for (const item of games) {
                const match = provider.normalize(item);

                if (!match || match.gameId == null) {
                    continue;
                }

                const id = cleanId(match.gameId);

                if (!id) {
                    continue;
                }

                match.gameId = String(match.gameId);
                match.apiProvider = providerName;
                match.updatedAt = Date.now();

                collected[id] = match;
            }

            console.log(
                date + ": received " + games.length + " matches"
            );
        } catch (error) {
            console.error(
                "Fetch failed for " + date + ":",
                error.message
            );
        }
    }

    if (successfulRequests === 0) {
        throw new Error(
            "All API requests failed. Firebase data was not changed."
        );
    }

    if (totalRawMatches > 0 && Object.keys(collected).length === 0) {
        throw new Error(
            "API returned data, but no valid matches were normalized. Firebase data was not changed."
        );
    }

    if (Object.keys(collected).length === 0) {
        throw new Error(
            "No matches found. Existing Firebase data was preserved."
        );
    }

    const oldSettings = settings;
    const oldProvider = String(
        oldSettings.last_synced_api_provider || ""
    ).toLowerCase();

    const providerChanged =
        oldProvider !== "" && oldProvider !== providerName;

    const oldAvailable = asObject(root.availableMatches);
    const oldMatches = asObject(root.matches);
    const oldCompetitionSelection =
        asObject(root.competition_selection);
    const oldCompetitions = asObject(root.competitions);
    const oldSelectedFixtures =
        asObject(root.selectedFixtures);

    // Keep stream URLs only when the provider has not changed.
    if (!providerChanged) {
        Object.keys(collected).forEach(function (id) {
            const previous =
                asObject(oldAvailable[id]);

            const previousMatch =
                asObject(oldMatches[id]);

            collected[id].streamUrl =
                previous.streamUrl ||
                previousMatch.streamUrl ||
                "";
        });
    }

    // Build competitions from the newly collected matches.
    const competitions = {};
    const competitionSelection = {};

    Object.keys(collected).forEach(function (id) {
        const match = collected[id];

        const competitionId = cleanId(
            match.competitionId ||
            match.league ||
            "unknown"
        );

        if (!competitions[competitionId]) {
            const oldCompetition =
                asObject(oldCompetitions[competitionId]);

            competitions[competitionId] = {
                id: competitionId,
                name: match.league || "Unknown competition",
                sportId: match.sportId || 1,
                selected: providerChanged
                    ? false
                    : oldCompetition.selected === true
            };

            const oldSelection =
                oldCompetitionSelection[competitionId];

            competitionSelection[competitionId] =
                providerChanged
                    ? false
                    : oldSelection === true ||
                      (
                          oldSelection &&
                          oldSelection.selected === true
                      ) ||
                      oldCompetition.selected === true;
        }
    });

    const selectedMatches = {};

    Object.keys(collected).forEach(function (id) {
        const match = collected[id];

        const competitionId = cleanId(
            match.competitionId ||
            match.league ||
            "unknown"
        );

        const selected =
            competitionSelection[competitionId] === true;

        if (selected) {
            selectedMatches[id] = match;
        }
    });

    // Do not modify Firebase until fetching and normalization succeeded.
    const updates = {
        availableMatches: collected,
        competitions: competitions,
        competition_selection: competitionSelection,
        matches: selectedMatches,
        settings: Object.assign({}, oldSettings, {
            last_synced_api_provider: providerName,
            lastSuccessfulSync: Date.now(),
            lastSyncMatchCount: Object.keys(collected).length,
            lastSyncStatus: "success"
        })
    };

    if (providerChanged) {
        updates.selectedFixtures = null;
        console.log(
            "Provider changed. Old provider selections and match data reset."
        );
    } else {
        updates.selectedFixtures = oldSelectedFixtures;
    }

    await rootRef.update(updates);

    console.log("Sync successful.");
    console.log("Provider:", providerName);
    console.log("Matches:", Object.keys(collected).length);
    console.log("Selected matches:", Object.keys(selectedMatches).length);
}

main().catch(function (error) {
    console.error("SYNC FAILED:", error.message);
    process.exitCode = 1;
});
