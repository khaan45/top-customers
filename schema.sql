-- ============================================================
-- STUDENT VOTING SYSTEM — SCHEMA
-- ============================================================

CREATE TABLE students (
    student_id      VARCHAR(10) PRIMARY KEY,      -- e.g. 'STU-00001'
    full_name       VARCHAR(150) NOT NULL,
    phone_number    VARCHAR(20) NOT NULL UNIQUE,  -- normalized format, e.g. '252634449111'
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- One-time codes sent to a phone before letting a vote through.
-- A row is created per attempt; short-lived and single-use.
CREATE TABLE otp_codes (
    id              SERIAL PRIMARY KEY,
    phone_number    VARCHAR(20) NOT NULL,
    code_hash       VARCHAR(64) NOT NULL,         -- store a hash, never the raw code
    expires_at      TIMESTAMP NOT NULL,
    attempts        INT DEFAULT 0,                 -- failed-guess counter
    consumed        BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Records THAT a student voted — no candidate/choice here, so this
-- table alone can't reveal who someone voted for.
CREATE TABLE votes (
    student_id      VARCHAR(10) PRIMARY KEY REFERENCES students(student_id),
    voted_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ballot_token    VARCHAR(64) NOT NULL UNIQUE   -- links to the anonymous ballot row
);

-- The actual choice — keyed only by a random token, not by student_id,
-- so it can't be joined back to a specific voter.
CREATE TABLE ballots (
    ballot_token    VARCHAR(64) PRIMARY KEY,
    candidate_id    VARCHAR(50) NOT NULL,
    submitted_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
