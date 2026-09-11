import httpx
import json
from app.config import settings

class QwenClient:
    def __init__(self):
        self.api_url = settings.qwen_api_url
        self.timeout = 60.0

    async def generate_text_stream(self, user_prompt: str, system_prompt: str, max_tokens: int = 600):
        max_tokens = max(50, min(1000, max_tokens))
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            try:
                data = {
                    "user_prompt": user_prompt,
                    "system_prompt": system_prompt,
                    "max_tokens": str(max_tokens)
                }
                async with client.stream("POST", f"{self.api_url}/text", data=data) as response:
                    response.raise_for_status()
                    async for chunk in response.aiter_text():
                        yield chunk
            except Exception as e:
                yield f"Error calling Qwen API: {str(e)}"
    
    async def generate_text(self, user_prompt: str, system_prompt: str, max_tokens: int = 600) -> str:
        max_tokens = max(50, min(1000, max_tokens))
        result = []
        async for chunk in self.generate_text_stream(user_prompt, system_prompt, max_tokens):
            result.append(chunk)
        return "".join(result)
        
    async def analyze_image(self, image_url: str, prompt: str) -> str:
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            try:
                data = {"image_url": image_url, "prompt": prompt}
                response = await client.post(f"{self.api_url}/image", json=data)
                response.raise_for_status()
                return response.text
            except Exception as e:
                return f"Error analyzing image: {str(e)}"
                
    async def test_connection(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                res = await client.get(self.api_url)
                return res.status_code == 200 or res.status_code == 404
        except:
            return False
