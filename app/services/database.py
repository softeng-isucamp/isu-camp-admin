import psycopg2

# Supabase PostgreSQL connection
connection = psycopg2.connect(
    host="aws-0-ap-south-1.pooler.supabase.com",
    port=5432,
    database="postgres",
    user="postgres.shcocbfainmlcloyucgj",
    password="justine@09pogI"
)

cursor = connection.cursor()

cursor.execute("SELECT 1;")

result = cursor.fetchone()

print("Connected to Supabase!")
print("Database response:", result)

cursor.close()
connection.close()