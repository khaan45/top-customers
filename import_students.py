"""
Imports Student_Database_Template.xlsx into the `students` table.

Only rows with a Student ID filled in are imported — a blank Student ID means
that row was never confirmed against the registrar, so it's skipped rather
than treated as an enrolled student. Run this again after updating the sheet;
it upserts, so it's safe to re-run.

Usage:
    pip install openpyxl psycopg2-binary --break-system-packages
    python import_students.py path/to/Student_Database_Template.xlsx \\
        --db postgresql://user:pass@host:5432/dbname
"""

import argparse
import re
import sys

import openpyxl
import psycopg2


def normalize_phone(raw):
    if not raw:
        return None
    digits = re.sub(r"\D", "", str(raw))
    if digits.startswith("0"):
        digits = "252" + digits[1:]
    elif not digits.startswith("252"):
        digits = "252" + digits
    return digits


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("xlsx_path")
    parser.add_argument("--db", required=True, help="Postgres connection string")
    parser.add_argument("--sheet", default="Students")
    args = parser.parse_args()

    wb = openpyxl.load_workbook(args.xlsx_path, data_only=True)
    ws = wb[args.sheet]

    rows = list(ws.iter_rows(min_row=2, values_only=True))

    imported, skipped_blank_id, skipped_bad_phone = 0, 0, 0
    to_insert = []

    for row in rows:
        if not row or all(v is None for v in row):
            continue
        full_name, phone_raw, student_id = (row + (None, None, None))[:3]

        if not student_id or str(student_id).strip() == "":
            skipped_blank_id += 1
            continue

        phone = normalize_phone(phone_raw)
        if not phone or len(phone) < 9:
            skipped_bad_phone += 1
            continue

        to_insert.append((str(student_id).strip(), str(full_name).strip(), phone))

    conn = psycopg2.connect(args.db)
    cur = conn.cursor()
    for student_id, full_name, phone in to_insert:
        cur.execute(
            """
            INSERT INTO students (student_id, full_name, phone_number)
            VALUES (%s, %s, %s)
            ON CONFLICT (student_id) DO UPDATE
              SET full_name = EXCLUDED.full_name,
                  phone_number = EXCLUDED.phone_number
            """,
            (student_id, full_name, phone),
        )
        imported += 1
    conn.commit()
    cur.close()
    conn.close()

    print(f"Imported/updated: {imported}")
    print(f"Skipped (no Student ID yet — not verified): {skipped_blank_id}")
    print(f"Skipped (unusable phone number): {skipped_bad_phone}")


if __name__ == "__main__":
    sys.exit(main())
