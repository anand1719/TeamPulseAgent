const {
    CloudAdapter,
    ConfigurationBotFrameworkAuthentication
} = require("botbuilder");

// =========================================
// BOT AUTHENTICATION
// =========================================

const botFrameworkAuthentication =
    new ConfigurationBotFrameworkAuthentication(
        process.env
    );

// =========================================
// CREATE ADAPTER
// =========================================

const adapter =
    new CloudAdapter(
        botFrameworkAuthentication
    );

// =========================================
// GLOBAL ERROR HANDLER
// =========================================

adapter.onTurnError = async (
    context,
    error
) => {

    console.error(
        "\n [onTurnError] unhandled error:",
        error
    );

    try {

        await context.sendActivity(
            "The bot encountered an error."
        );

    } catch (err) {

        console.error(
            "Failed sending error activity:",
            err
        );
    }
};

module.exports = adapter;