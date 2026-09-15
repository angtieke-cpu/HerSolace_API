const db = require("../db");
const { generateToken } = require("../utils/jwt");

exports.saveJourneyDetails = async (req, res) => {
  const client = await db.connect();

  try {
    const userId = req.user.userId;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "userId required",
      });
    }

    const {
      name,
      ageGroup,
      dateOfBirth,
      cycleLengthDays,
      bleedingDays,
      symptoms,
      lastPeriodDate,
      healthGoals,
      diagnosedConditions,
      trackingSymptoms,
    } = req.body;

    if (
      !name ||
      !ageGroup ||
      !dateOfBirth ||
      !cycleLengthDays ||
      !bleedingDays ||
      !lastPeriodDate
    ) {
      return res.status(400).json({
        success: false,
        message: "Missing journey details",
      });
    }

    /*
     * STEP 0
     * Determine whether this is:
     *
     * 1. Mobile signup -> user exists in temp_users
     * 2. Social signup -> user already exists in users
     */

    const tempUserResult = await client.query(
      `
      SELECT
        id,
        mobile_number,
        is_verified,
        email,
        image_base64
      FROM temp_users
      WHERE id = $1
      `,
      [userId]
    );

    const existingUserResult = await client.query(
      `
      SELECT
        id,
        mobile_number,
        name,
        email
      FROM users
      WHERE id = $1
      `,
      [userId]
    );

    const tempUser = tempUserResult.rows[0] || null;
    const existingUser = existingUserResult.rows[0] || null;

    /*
     * User must exist either in temp_users
     * or users.
     */
    if (!tempUser && !existingUser) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // TEST USER BYPASS
    if (
      tempUser &&
      String(tempUser.mobile_number) === "1111111111"
    ) {
      const testUserResult = await client.query(
        `
        SELECT
          id,
          mobile_number,
          name
        FROM users
        WHERE mobile_number = $1
        LIMIT 1
        `,
        ["1111111111"]
      );

      if (testUserResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Test user not found in users table",
        });
      }

      const user = testUserResult.rows[0];

      const token = generateToken({
        userId: user.id,
        mobileNumber: user.mobile_number,
      });

      return res.status(200).json({
        success: true,
        token,
        user: {
          id: user.id,
          mobileNumber: user.mobile_number,
          name: user.name,
        },
      });
    }

    await client.query("BEGIN");

    /*
     * MOBILE SIGNUP
     *
     * User currently exists in temp_users.
     * Move them into users.
     */
    if (tempUser && !existingUser) {
      await client.query(
        `
        INSERT INTO users (
          id,
          mobile_number,
          is_verified,
          name,
          email,
          image_base64
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        `,
        [
          tempUser.id,
          tempUser.mobile_number,
          tempUser.is_verified,
          name,
          tempUser.email,
          tempUser.image_base64,
        ]
      );

      await client.query(
        `
        DELETE FROM temp_users
        WHERE id = $1
        `,
        [userId]
      );
    }

    /*
     * SOCIAL SIGNUP
     *
     * Google/Facebook already created the user
     * in users table.
     *
     * Just update the name supplied during onboarding.
     */
    if (existingUser) {
      await client.query(
        `
        UPDATE users
        SET name = $2
        WHERE id = $1
        `,
        [userId, name]
      );
    }

    /*
     * Prevent duplicate journey creation.
     */
    const journeyCheck = await client.query(
      `
      SELECT id
      FROM journey_details
      WHERE user_id = $1
      LIMIT 1
      `,
      [userId]
    );

    if (journeyCheck.rows.length > 0) {
      await client.query("ROLLBACK");

      return res.status(409).json({
        success: false,
        message: "Journey details already exist",
      });
    }

    // INSERT JOURNEY DETAILS
    const journeyResult = await client.query(
      `
      INSERT INTO journey_details (
        user_id,
        age_group,
        date_of_birth,
        cycle_length_days,
        bleeding_days,
        symptoms,
        last_period_date,
        health_goals,
        diagnosed_conditions,
        tracking_symptoms
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10
      )
      RETURNING id
      `,
      [
        userId,
        ageGroup,
        dateOfBirth,
        cycleLengthDays,
        bleedingDays,
        symptoms || [],
        lastPeriodDate,
        healthGoals || [],
        diagnosedConditions || [],
        trackingSymptoms || [],
      ]
    );

    // INSERT INITIAL PERIOD LOG
    await client.query(
      `
      INSERT INTO user_period_log (
        user_id,
        period_date,
        bleeding_days,
        cycle_length
      )
      VALUES ($1,$2,$3,$4)
      `,
      [
        userId,
        lastPeriodDate,
        bleedingDays,
        cycleLengthDays,
      ]
    );

    // GET FINAL USER
    const finalUserResult = await client.query(
      `
      SELECT
        id,
        mobile_number,
        name,
        email
      FROM users
      WHERE id = $1
      `,
      [userId]
    );

    const user = finalUserResult.rows[0];

    await client.query("COMMIT");

    const token = generateToken({
      userId: user.id,
      mobileNumber: user.mobile_number || null,
    });

    return res.status(201).json({
      success: true,
      message: "Journey details saved successfully",
      token,
      journeyId: journeyResult.rows[0].id,

      user: {
        id: user.id,
        mobileNumber: user.mobile_number,
        name: user.name,
        email: user.email,
      },
    });

  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("Journey rollback error:", rollbackError);
    }

    console.error("Journey save error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to save journey details",
    });

  } finally {
    client.release();
  }
};


