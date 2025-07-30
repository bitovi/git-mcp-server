#!/bin/sh

# Create .git-credentials file if GIT_TOKEN is provided
if [ -n "$GIT_TOKEN" ]; then
    echo "Setting up Git credentials from GIT_TOKEN..."
    
    # Default username if not provided
    GIT_USERNAME=${GIT_USERNAME:-"token"}
    
    # Create .git-credentials file
    echo "https://${GIT_USERNAME}:${GIT_TOKEN}@github.com" > /home/appuser/.git-credentials
    
    # Set proper permissions
    chmod 600 /home/appuser/.git-credentials
    
    # Configure git to use the credential store
    git config --global credential.helper store
    git config --global credential.https://github.com.username "$GIT_USERNAME"
    
    echo "Git credentials configured successfully"
else
    echo "No GIT_TOKEN provided, skipping Git credential setup"
fi

# Execute the original command
exec "$@"
