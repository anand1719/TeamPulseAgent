const axios = require("axios");
async function generateDynamicQuestion(ticketDetails) {

    const prompt = `
    You are a Smart Standup AI Agent.
    Analyze the following Azure DevOps ticket details
    and generate one intelligent standup question.
    ${ticketDetails}
    `;

    const response = await axios.post(
        "http://localhost:11434/api/generate",
        {
            model: "qwen2.5-coder:7b",
            prompt: prompt,
            stream: false
        }
    );

    return response.data.response;
}

module.exports = {
    generateDynamicQuestion
};