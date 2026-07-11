from flask import Flask, render_template, request, jsonify, session
import requests
import json
import random
import socket
import os
from urllib.parse import quote
from dotenv import load_dotenv
from datetime import datetime

load_dotenv()

app = Flask(__name__)
app.secret_key = os.getenv('SECRET_KEY', 'dev-secret-key-change-in-production')

# Configuration
AWS_REGION = os.getenv('AWS_REGION', 'ap-southeast-1')
DEFAULT_MODEL = os.getenv('DEFAULT_MODEL', 'anthropic.claude-3-haiku-20240307-v1:0')
DEFAULT_MAX_TOKENS = 8192
DEFAULT_TEMPERATURE = 0.7
CHAT_HISTORY = []

def bedrock_converse_url(region, model_id):
    """Build AWS Bedrock Converse API URL"""
    encoded_model_id = quote(model_id, safe="")
    return f"https://bedrock-runtime.{region}.amazonaws.com/model/{encoded_model_id}/converse"

def find_available_port(start_port=5000, max_attempts=10):
    """Find an available port starting from start_port"""
    for port in range(start_port, start_port + max_attempts):
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.bind(('0.0.0.0', port))
            sock.close()
            return port
        except OSError:
            continue
    raise RuntimeError(f"No available ports found between {start_port} and {start_port + max_attempts - 1}")

def bedrock_converse_url(region, model_id):
    """Build AWS Bedrock Converse API URL"""
    encoded_model_id = quote(model_id, safe="")
    return f"https://bedrock-runtime.{region}.amazonaws.com/model/{encoded_model_id}/converse"

def call_bedrock_api(api_key, messages, system_prompt, max_tokens, temperature):
    """Call AWS Bedrock Converse API"""
    url = bedrock_converse_url(AWS_REGION, DEFAULT_MODEL)
    
    headers = {
        'Authorization': f'Bearer {api_key}',
        'Content-Type': 'application/json',
        'User-Agent': 'SafeGraph-Chatbot/1.0'
    }
    
    payload = {
        'messages': messages,
        'system': system_prompt,
        'max_tokens': max_tokens,
        'temperature': temperature
    }
    
    try:
        response = requests.post(url, json=payload, headers=headers, timeout=30)
        response.raise_for_status()
        return response.json()
    except requests.exceptions.HTTPError as e:
        if e.response.status_code == 401:
            return {'error': 'Invalid API key. Please check your credentials.', 'status': 401}
        elif e.response.status_code == 403:
            return {'error': 'Access denied. Check API key permissions.', 'status': 403}
        else:
            return {'error': f'API Error: {e.response.status_code} - {e.response.text}', 'status': e.response.status_code}
    except requests.exceptions.Timeout:
        return {'error': 'Request timeout. Please try again.', 'status': 408}
    except requests.exceptions.RequestException as e:
        return {'error': f'Connection error: {str(e)}', 'status': 500}

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/chat', methods=['POST'])
def chat():
    """Handle chat messages"""
    data = request.json
    api_key = data.get('api_key', '').strip()
    user_message = data.get('message', '').strip()
    messages = data.get('messages', [])
    system_prompt = data.get('system_prompt', 'You are a helpful AI assistant.')
    max_tokens = data.get('max_tokens', DEFAULT_MAX_TOKENS)
    temperature = data.get('temperature', DEFAULT_TEMPERATURE)
    
    # Validate inputs
    if not api_key:
        return jsonify({'error': 'API key is required'}), 400
    if not user_message:
        return jsonify({'error': 'Message cannot be empty'}), 400
    
    # Add user message to conversation
    messages.append({
        'role': 'user',
        'content': user_message
    })
    
    # Call Bedrock API
    result = call_bedrock_api(api_key, messages, system_prompt, max_tokens, temperature)
    
    if 'error' in result:
        return jsonify(result), result.get('status', 500)
    
    # Extract assistant response
    try:
        assistant_message = result.get('output', {}).get('message', {}).get('content', [])
        if isinstance(assistant_message, list) and len(assistant_message) > 0:
            response_text = assistant_message[0].get('text', 'No response')
        else:
            response_text = str(assistant_message)
        
        # Calculate tokens (rough estimate)
        input_tokens = result.get('usage', {}).get('input_tokens', 0)
        output_tokens = result.get('usage', {}).get('output_tokens', 0)
        total_tokens = input_tokens + output_tokens
        CHAT_HISTORY.append({'user': user_message, 'assistant': response_text, 'tokens': total_tokens, 'timestamp': datetime.now().isoformat()})
        
        return jsonify({
            'response': response_text,
            'tokens': total_tokens,
            'input_tokens': input_tokens,
            'output_tokens': output_tokens
        })
    except (KeyError, IndexError, TypeError) as e:
        return jsonify({'error': f'Failed to parse API response: {str(e)}'}), 500

@app.route('/dashboard')
def dashboard():
    """Render dashboard page"""
    return render_template('dashboard.html')

@app.route('/api/dashboard-stats')
def dashboard_stats():
    """Get dashboard statistics"""
    total_tokens = sum(msg.get('tokens', 0) for msg in CHAT_HISTORY)
    total_messages = len(CHAT_HISTORY)
    avg_tokens = total_tokens // total_messages if total_messages > 0 else 0
    
    # Simulate daily usage data
    daily_data = [
        {'day': 'Mon', 'tokens': random.randint(500, 2000)},
        {'day': 'Tue', 'tokens': random.randint(500, 2000)},
        {'day': 'Wed', 'tokens': random.randint(500, 2000)},
        {'day': 'Thu', 'tokens': random.randint(500, 2000)},
        {'day': 'Fri', 'tokens': random.randint(500, 2000)},
        {'day': 'Sat', 'tokens': random.randint(500, 2000)},
        {'day': 'Sun', 'tokens': random.randint(500, 2000)},
    ]
    
    return jsonify({
        'total_tokens': total_tokens,
        'total_messages': total_messages,
        'avg_tokens_per_message': avg_tokens,
        'daily_data': daily_data,
        'recent_chats': CHAT_HISTORY[-5:] if CHAT_HISTORY else [],
        'api_status': 'healthy',
        'model': DEFAULT_MODEL,
        'region': AWS_REGION
    })

@app.route('/clear', methods=['POST'])
def clear_chat():
    """Clear chat history"""
    return jsonify({'status': 'cleared'})

@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({'status': 'ok', 'timestamp': datetime.now().isoformat()})

if __name__ == '__main__':
    port = find_available_port(5000)
    print(f"Starting Flask app on port {port}")
    app.run(debug=True, host='0.0.0.0', port=port)
