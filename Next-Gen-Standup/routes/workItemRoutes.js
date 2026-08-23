const express = require("express");

const router = express.Router();

const {
    getWorkItemByMember,
    saveWorkItem
} = require("../services/workItemService");

// ===========================================
// GET WORK ITEMS BY MEMBER
// ===========================================

router.get("/:memberName", async (req, res) => {

    try {

        const { memberName } = req.params;

        const result =
            await getWorkItemByMember(memberName);

        res.json(result);

    } catch (error) {

        console.error(error);

        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// ===========================================
// SAVE WORK ITEM SNAPSHOT
// ===========================================

router.post("/", async (req, res) => {

    try {

        const result =
            await saveWorkItem(req.body);

        res.json(result.rows[0]);

    } catch (error) {

        console.error(error);

        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

module.exports = router;