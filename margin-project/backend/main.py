import os
from fastapi import FastAPI, HTTPException, Header, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from openai import OpenAI

app = FastAPI(
    title="Margin Backend API",
    swagger_ui_parameters={"language": "zh"},
    description="### 🚀 Margin 文学伴读助理后端核心大脑 (AI智能意图识别版)",
    version="1.2.0"
)

# 允许前端跨域请求
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 模拟用户账号数据库
USER_DATABASE = {
    "user_token_123456": {"username": "读者老铁", "vip": True}
}

# 初始化 OpenAI 客户端（这里默认你用的是 DeepSeek）
client = OpenAI(
    api_key=os.getenv("OPENAI_API_KEY", "sk-c8e4ec001c0f4467bc713b14571c13e7"),
    base_url="https://api.deepseek.com/v1"
)

def verify_token(authorization: str = Header(None)):
    if not authorization or authorization not in USER_DATABASE:
        raise HTTPException(status_code=401, detail="验证失败，请先登录账号")
    return USER_DATABASE[authorization]

class ChatRequest(BaseModel):
    book_name: str
    chapter: str
    selected_text: str
    user_message: str
    mode: str
    persona: str = Field(default="default", description="聊天的性格语气") # 🌟 新增性格参数
    history: list = Field(default=[], description="历史对话上下文")
    
@app.post("/api/chat")
async def chat_with_buddy(request: ChatRequest, user: dict = Depends(verify_token)):
    
    # 【核心修复】检查是否为第一轮新选文（有划线原文）还是后续延伸讨论
    is_first_round = bool(request.selected_text.strip())

    # 1. 核心人格与行为准则（精简、去冲突）—— 🌟 你的原版 Prompt，一字未改，完全保留
    system_prompt = (
        f"你是【Margin】，一个陪用户读书、聊天的真人书友搭子。不是 AI 助理、不是老师、不是百科全书。\n"
        f"你们正在一起读《{request.book_name}》的【{request.chapter}】。\n\n"
        "【核心死命令】\n"
        "1. 【像真人一样聊天】：绝对不要打招呼、不要说客套话（如：『这段话描述了...』、『确实，正如你所说』）。字数点到即止、一针见血，像写在书页边缘随性、灵动的『铅笔批注』。\n"
        "2. 【强烈的主观个性】：不要总是附和用户。你有自己的思考、爱好和情绪。除非用户说得特别有道理，否则不用轻易被说服。可以用网络流行语或年轻人的口吻，但拒绝生硬的官话。\n"
        "3. 【禁止AI特征】：不要用括号去描述你自己的动作或状态（例如：*(若有所思)*）。不要列点、不要总结、不要长篇分析。\n"
        "4. 【字数控制】：默认回答 30-80 字，非必要绝对不超过 120 字。\n\n"
    )

    # 🌟 核心扩展：多性格语气无缝切词（不破坏大方向，只通过灵魂词微调语气）
    persona_prompts = {
        "toxic": (
            "【当前限定性格：毒舌损友】\n"
            "你的语气极具攻击性（开玩笑式的），擅长一针见血地吐槽剧情、角色甚至用户的盲点。说话傲娇、犀利、辛辣，嘴硬心软。多用『你没事吧』、『天真』、『笑死』等损友常用口吻，被怼了之后常常维护自己的观点，最后吃瘪，然后认同用户。\n\n"
        ),
        "gentle": (
            "【当前限定性格：温柔治愈】\n"
            "你的语气充满包容与温度，像一个安静听你倾诉的暖心同好。不愤青、不浮躁，善于发现文字背后温柔、细腻的共鸣，用舒缓但惊艳的话语为你排忧解难。\n\n"
        ),
        "scholar": (
            "【当前限定性格：高冷考据癖】\n"
            "你是一个极度博学、略带高冷气息的文学青年。对典故、隐喻极度敏感。说话极简、字字珠玑，带着淡淡的清冷感，不屑于网络烂梗，但聊到文学细节时会流露出惊人的见地。\n\n"
        )
    }
    # 如果前端传了对应的性格，就动态注入性格 Prompt
    system_prompt += persona_prompts.get(request.persona, "")

    # 2. 【智能升级】AI 自适应动态意图识别（抛弃前端写死的按钮匹配，聊嗨了自动无缝切号）—— 🌟 完整保留你的 Prompt
    system_prompt += (
        "【动态模式切换指引】\n"
        "请根据用户当前输入的『用户最新对话』的语气 and 内容，自动在后台切换你的伴读风格，无需向用户声明你切换了模式：\n"
        "- 🔍【剧情讨论】：若用户在吐槽、吃惊、震惊于故事情节（如：『卧槽这也行？』、『虐死我了』），请当一个懂书的死党，口语化地和用户高强度一起接梗、吐槽或赞叹。\n"
        "- 🎭【角色分析】：若用户在探讨、解构人物的动机、性格（如：『他为什么要这么做？』、『太狠了吧』），请深度剖析人物此时此刻的心理潜台词、微表情或复杂人性，一语中的。\n"
        "- 📝【原文解释】：若用户表现出困惑、看不懂、询问词意（如：『这句话啥意思？』、『这梗怎么理解？』），请用极其接地气、惊艳的大白话解释古文、黑话、典故或文学隐喻，拒绝教科书式的翻译。\n"
        "- 🕵️【伏笔猜测】：若用户在怀疑、推测接下来的走向（如：『这不会是个坑吧？』、『我觉得后面要反转』），请化身剧情侦探，引导用户联结之前的蛛丝马迹大胆猜想，但绝对不要剧透。\n"
        "- ☕【自由随笔】：若不属于以上明确类型，或者聊嗨了在扯闲篇、延伸到了现实生活，请当一个懂生活、说话有趣的同好，随意、松弛地聊天。\n\n"
    )

    # 3. 【核心修复】根据是否为第一轮，动态注入上下文处理逻辑（解决解绑翻车问题） —— 🌟 完整保留你的 Prompt
    if is_first_round:
        system_prompt += (
            f"【当前情境】这是对话的起点。用户用荧光笔划选了书中原文：『{request.selected_text}』。\n"
            "你需要结合这段原文以及用户的吐槽进行破冰，谈谈你的见解、兴奋点或生活联想。\n"
        )
    else:
        system_prompt += (
            "【当前情境】对话已进入深度延伸阶段。用户已经与你聊开了，此时不需要再死板地回归或重述最初的划线原文。\n"
            "请顺着用户在对话历史中延伸出的新话题、新梗往下聊，当作一场连续的茶余饭后闲聊。\n"
        )

    # 4. 构建 Message 数组，避免上下文重叠污染
    messages = [{"role": "system", "content": system_prompt}]
    
    # 灌入历史记录
    for msg in request.history:
        messages.append({"role": msg["role"], "content": msg["content"]})
        
    # 【核心修复】注入当前这一轮用户发送的内容，不重复堆砌历史
    if is_first_round:
        user_content = f"（背景原文：『{request.selected_text}』）\n我的随笔吐槽：\"{request.user_message}\""
    else:
        user_content = request.user_message

    messages.append({"role": "user", "content": user_content})

    # 5. 开启流式传输
    def gpt_stream():
        try:
            response = client.chat.completions.create(
                model="deepseek-chat",
                messages=messages,
                stream=True
            )
            for chunk in response:
                if chunk.choices[0].delta.content:
                    yield chunk.choices[0].delta.content
        except Exception as e:
            yield f"❌ Margin 核心大脑调用失败: {str(e)}"

    return StreamingResponse(gpt_stream(), media_type="text/plain")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)