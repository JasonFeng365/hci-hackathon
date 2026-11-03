import bcrypt

def hash_password(password: str) -> str:
    # 1. Convert the password string into bytes
    password_bytes = password.encode('utf-8')
    
    # 2. Generate a random salt (automatically uses a safe work factor/cost)
    salt = bcrypt.gensalt()
    
    # 3. Hash the password and decode the resulting bytes back into a string for database storage
    hashed_password = bcrypt.hashpw(password_bytes, salt)
    return hashed_password.decode('utf-8')

def verify_password(plain_password: str, hashed_password: str) -> bool:
    # Convert inputs to bytes and check if they match
    return bcrypt.checkpw(
        plain_password.encode('utf-8'), 
        hashed_password.encode('utf-8')
    )

# --- Example Usage ---
registration_input = "SuperSecureP@ss123"
stored_hash = hash_password(registration_input)
print(f"Stored Hash: {stored_hash}")

# When a user tries to log in:
print(verify_password("SuperSecureP@ss123", stored_hash))  # Returns: True
print(verify_password("wrong_password", stored_hash))      # Returns: False