from flask import Flask, render_template, request, jsonify
import boto3
import json

app = Flask(__name__)
client = boto3.client('bedrock-runtime', region_name='us-east-1')

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/chat', methods=['POST'])
def chat():
    user_message = request.json.get('message')
    try:
        response = client.invoke_model(
            modelId="anthropic.claude-3-sonnet-20240229-v1:0",
            body=json.dumps({
                "anthropic_version": "bedrock-2023-06-01",
                "max_tokens": 1024,
                "messages": [{"role": "user", "content": user_message}]
            })
        )
        result = json.loads(response['body'].read())
        return jsonify({"reply": result['content'][0]['text']})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True)