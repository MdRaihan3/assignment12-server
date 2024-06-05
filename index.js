const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const express = require('express');
const jwt = require('jsonwebtoken')
const cors = require('cors');
const app = express()
require('dotenv').config()
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY)

const port = process.env.PORT || 5000;

// middleware
app.use(cors())
app.use(express.json())

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.cy5pfmj.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();

        const userCollection = client.db('RWorkerDB').collection('users')
        const taskCollection = client.db('RWorkerDB').collection('tasks')
        const paymentCollection = client.db('RWorkerDB').collection('payments')

        // jwt related
        app.post('/jwt', (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET,
                { expiresIn: '5h' })
            res.send({ token })
        })

        const verifyToken = async (req, res, next) => {
            console.log('abadaba authorization', req.headers?.Authorization);
            if (!req.headers?.authorization) {
                return res.status(401).send({ message: 'Unauthorized access....' })
            }
            const token = req.headers?.authorization.split(' ')[1]
            console.log("token in verifyToken", token);
            if (!token) { return res.status(401).send({ message: 'unauthorized access...' }) }
            jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
                if (err) { return res.status(403).send({ message: 'Forbidden access' }) }
                req.user = decoded
                next()
            })
        }

        const verifyAdmin = async (req, res, next) => {
            const query = { email: req?.user?.email }
            const result = await userCollection.findOne(query)
            const admin = result?.role === 'admin'
            if (!admin) { return res.status(403).send({ message: 'forbidden access from verifyAdmin' }) }
            next()
        }

        const verifyTaskCreator = async (req, res, next) => {
            const query = { email: req.user?.email }
            const result = await userCollection.findOne(query)
            const taskCreator = result.role === 'taskCreator'
            if (taskCreator) { return res.status(403).send({ message: 'forbidden access' }) }
            next()
        }

        app.post('/users', async (req, res) => {
            const user = req.body;
            const query = { email: user?.email }
            const existingUser = await userCollection.findOne(query)
            if (existingUser) {
                return res.send({ message: 'user already existed' })
            }
            const result = await userCollection.insertOne(user)
            res.send(result)
        })

        app.get('/user/:email', async (req, res) => {
            const query = { email: req.params?.email }
            const result = await userCollection.findOne(query)
            res.send(result)
        })

        app.get('/users', verifyToken, verifyAdmin, async (req, res) => {
            const result = await userCollection.find().toArray()
            res.send(result)
        })

        app.get(`/users/admin/:email`, verifyToken, async (req, res) => {
            const email = req.params.email;
            if (email !== req.decoded.email) {
                return res.status(403).send({ message: 'forbidden access....' })
            }
            const query = { email: email }
            const user = await userCollection.findOne(query)
            let admin = false
            if (user) {
                admin = user?.role === 'admin'
            }
            res.send({ admin })
        })

        app.patch('/users/updateRole/:id', verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params?.id;
            const newUpdateRole = req.body?.updatedRole;
            console.log('body in update', 100, req.body);
            console.log('updatedRole', 101, newUpdateRole);
            const filter = { _id: new ObjectId(id) }
            const updateDoc = { $set: { role: newUpdateRole } }
            const result = await userCollection.updateOne(filter, updateDoc)
            res.send(result)
        })

        app.delete('/users/delete/:id', verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params?.id;
            const query = { _id: new ObjectId(id) }
            const result = await userCollection.deleteOne(query)
            res.send(result)
        })

        // task related
        app.post('/tasks', async (req, res) => {
            const taskInfos = req.body;
            const filter = { email: taskInfos?.creatorEmail }
            const taskCoin = parseFloat(taskInfos?.payableAmount)
            const updateDoc = { $inc: { coin: -taskCoin } }
            const deleteResult = await userCollection.updateOne(filter, updateDoc)
            const result = await taskCollection.insertOne(taskInfos)
            res.send(result)
        })

        app.get('/task/:id', async (req, res) => {
            const ids = req.params?.id
            const query = { _id: new ObjectId(ids) }
            const result = await taskCollection.findOne(query)
            res.send(result)
        })

        app.get('/tasks/:email', async (req, res) => {
            const email = req.params?.email;
            const query = { creatorEmail: email }
            const result = await taskCollection.find(query).toArray()
            res.send(result)
        })

        app.patch('/task/update/:id', async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) }
            const taskData = req?.body;
            const updateDoc = { $set: taskData }
            const result = await taskCollection.updateOne(filter, updateDoc)
            res.send(result)
        })

        app.delete('/tasks/:id', async (req, res) => {
            const ids = req.params?.id;
            const query = { _id: new ObjectId(ids) }
            const result = await taskCollection.deleteOne(query)
            res.send(result)
        })

        // payments related
        app.post('/create-payment-intent', async (req, res) => {
            const { price } = req.body;
            const amount = parseFloat(price * 100)
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: "usd",
                payment_method_types: ['card']
            })
            res.send({
                clientSecret: paymentIntent.client_secret
            })
        })

        app.get('/payment/get/:email', async(req, res)=>{
            const email = req.params?.email;
            const query = {email: email}
            const result = await paymentCollection.find(query).toArray()
            res.send(result)
        })

        app.patch('/payment/update/:email', async (req, res) => {
            const paymentInfo = req.body?.paymentInfo
            console.log(paymentInfo)
            const coins = parseFloat(paymentInfo?.purchasedCoin)
            console.log('coins', coins);
            const email = req.params?.email;
            const filter = { email: email }
            const updateDoc = { $inc: { coin: coins } }
            const coinResult = await userCollection.updateOne(filter, updateDoc)

            const paymentResult = await paymentCollection.insertOne(paymentInfo)

            res.send({coinResult, paymentResult})
        })


        // Send a ping to confirm a successful connection fasf
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);


app.get('/', (req, res) => {
    res.send('Pico is here')
})

app.listen(port, () => {
    console.log('Pico is running on port', port);
})