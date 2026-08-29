import sqlite3
import pandas as pd

def show_database():
    print("\n" + "="*50)
    print(" ACCESSING SQLITE DATABASE (fakedoc.db)")
    print("="*50 + "\n")
    
    try:
        # Connect to the database
        conn = sqlite3.connect('fakedoc.db')
        
        print("--- TABLE: DOCUMENTS ---")
        # Use pandas to print it in a beautiful table format
        docs_df = pd.read_sql_query("SELECT * FROM documents", conn)
        if docs_df.empty:
            print("Table is empty (No documents uploaded yet).")
        else:
            print(docs_df.to_string(index=False))
            
        print("\n--- TABLE: AUDIT_LOG ---")
        logs_df = pd.read_sql_query("SELECT * FROM audit_log LIMIT 10", conn)
        if logs_df.empty:
            print("Table is empty.")
        else:
            print(logs_df.to_string(index=False))
            
        conn.close()
        
    except Exception as e:
        print(f"Error reading database: {e}")

if __name__ == "__main__":
    show_database()
